/* SPDX-License-Identifier: GPL-3.0-only */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./core.js') : root.DikaScheduleCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DikaBackground = api; if (root.DikaOffline) api.attach(root.DikaOffline); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  const PREFIX = 'dika-trial-offline-';
  const TASKS_KEY = 'dika.offline.v1.background.tasks';
  const OWNER = 'dika-trial-offline';
  const FACE_FLAGS = ['attendanceFace', 'attendanceFaceBlock', 'attendanceFaceLiveness', 'attendanceFaceLivenessBlocking', 'attendanceFaceLivenessGesture'];
  class Runner {
    constructor(app) {
      this.app = app; this.owned = new Set(); this.listenerId = null; this.initialized = false;
      this.signature = null; this.revision = 0; this.queue = Promise.resolve();
      this.currentTask = null; this.waking = false; this.lastWakeAt = null;
      this.pollWake = false; this.lastWakeSource = null;
      this.status = 'idle'; this.lastError = '';
      this.keeperId = null; this.keeperError = ''; this.keeperStartedAt = null;
      try {
        const ids = JSON.parse(app.storage.getItem(TASKS_KEY) || '[]');
        if (Array.isArray(ids)) ids.filter(id => typeof id === 'string' && id.startsWith(PREFIX)).forEach(id => this.owned.add(id));
      } catch (_) { this.status = 'storage-unavailable'; }
    }
    native(method, options = {}) {
      const cap = this.app.root.Capacitor;
      if (typeof cap?.nativePromise !== 'function') throw Error('Layanan native BackgroundFetch tidak tersedia.');
      return cap.nativePromise('BackgroundFetch', method, options);
    }
    persistTasks() { this.app.storage.setItem(TASKS_KEY, JSON.stringify([...this.owned])); }
    ownsWake() {
      return this.app.features.trial === true && this.waking && !!this.currentTask &&
        (this.owned.has(this.currentTask) || (this.pollWake && this.app.features.backgroundKeeper && this.keeperId !== null && !this.keeperError));
    }
    useOfflineDeviceTime(machine) {
      const app = this.app;
      // The shipped getCurrentTime already falls back to actual device time
      // after a failed request. Hidden WebViews may suspend its RxJS timeout.
      // Select that same fallback only for our active, genuinely offline task;
      // recordAttendance has already run the original checkAutoTime first.
      return this.ownsWake() && !!app.active && app.active.controller?.attendanceMachineService === machine &&
        app.active.identity === app.identity && app.account() === app.identity && machine.networkService?.isOffline === true;
    }
    diagnostics() {
      return { mode: 'warm-webview-experimental', status: this.status, initialized: this.initialized,
        scheduledCount: this.owned.size, lastWakeAt: this.lastWakeAt, lastWakeSource: this.lastWakeSource, error: this.lastError,
        locationService: { requested: this.keeperId !== null, startedAt: this.keeperStartedAt, error: this.keeperError },
        supportsProcessRestart: false };
    }
    async pollHidden() {
      const app = this.app;
      if (app.features.trial !== true || !app.features.backgroundKeeper || !app.features.scheduler ||
          app.doc.visibilityState === 'visible' || !app.identity || !app.engine || !app.settings().enabled ||
          this.keeperId === null || this.keeperError || this.waking || app.active || app.engine.busy) return false;
      if (!Core.due(app.settings(), app.now(), app.engine.ledger, app.engine.trial).length) return false;
      const token = `${PREFIX}keeper-poll-${app.now()}`;
      this.currentTask = token; this.pollWake = true; this.waking = true; app.backgroundWake = true;
      this.lastWakeAt = app.now(); this.lastWakeSource = 'foreground-service-poll'; this.status = 'running';
      try { await app.engine.tick(); return true; }
      catch (error) { this.lastError = error.message || 'Pencatatan latar belakang berhenti.'; this.status = 'failed'; return false; }
      finally {
        if (this.currentTask === token) {
          this.currentTask = null; this.pollWake = false; this.waking = false; app.backgroundWake = false;
          if (this.status === 'running') this.status = 'finished';
        }
        // This is a service-owned timer attempt, not a native fetch event.
        // Never finish or remove a native task on behalf of this token.
        app.render();
      }
    }
    async startKeeper() {
      const app = this.app;
      if (!app.features.backgroundKeeper || this.keeperId !== null) return;
      if (app.doc.visibilityState !== 'visible') throw Error('Buka GreatDay untuk mengaktifkan layanan uji latar belakang.');
      const cap = app.root.Capacitor;
      const header = (cap.PluginHeaders || []).find(p => p.name === 'DikaBackgroundGeolocation');
      if (!header?.methods?.some(m => m.name === 'addWatcher')) throw Error('Layanan lokasi uji native belum terpasang.');
      this.keeperError = '';
      const id = cap.nativeCallback('DikaBackgroundGeolocation', 'addWatcher', {
        backgroundTitle: 'Jadwal GreatDay · build uji',
        backgroundMessage: 'Uji offline aktif. Pengiriman absensi ke server ditahan.',
        requestPermissions: false, stale: false, distanceFilter: 1000
      }, (_location, error) => {
        // Watcher locations are intentionally never used as attendance data.
        // Original recordAttendance requests and validates its own location.
        if (error) {
          this.keeperError = 'Layanan lokasi uji belum mendapat izin atau gagal dimulai.';
          this.status = 'unavailable';
          this.stopKeeper().catch(() => {}); app.render();
        }
      });
      if (typeof id !== 'string' || !id) throw Error('Identitas layanan lokasi native tidak tersedia.');
      this.keeperId = id; this.keeperStartedAt = app.now();
      if (this.keeperError) { await this.stopKeeper(); throw Error(this.keeperError); }
    }
    async stopKeeper() {
      const id = this.keeperId;
      if (id === null) return;
      await this.app.root.Capacitor.nativePromise('DikaBackgroundGeolocation', 'removeWatcher', { id });
      if (this.keeperId === id) { this.keeperId = null; this.keeperStartedAt = null; }
    }
    configureSchedule(force = false) {
      const app = this.app, config = app.settings();
      if (app.active || app.engine?.busy) return Promise.resolve(false);
      const signature = JSON.stringify([app.features.trial, app.features.scheduler, app.features.backgroundFetchVerifiedUnused, app.features.backgroundKeeper,
        app.identity, config, Core.wall(app.now(), Core.ZONE).date]);
      if (signature === this.signature && force !== true && force?.force !== true) return this.queue;
      this.signature = signature;
      const revision = ++this.revision;
      this.queue = this.queue.catch(() => {}).then(() => this.updateSchedule(config, revision)).catch(error => {
        this.status = 'unavailable'; this.lastError = error.message || 'Jadwal latar belakang belum tersedia.';
        this.signature = null; app.render(); return false;
      });
      return this.queue;
    }
    async cancelOwned() {
      for (const taskId of [...this.owned]) {
        if (taskId === this.currentTask) continue;
        await this.native('stop', { taskId }); this.owned.delete(taskId); this.persistTasks();
      }
    }
    async initialize() {
      if (this.initialized) return;
      const app = this.app, cap = app.root.Capacitor;
      // The callback is a singleton in this exact APK. This flag may only be
      // emitted for the fingerprint-locked build after checking all shipped
      // JS and native callers. There is no native API to enumerate callbacks.
      if (app.features.backgroundFetchVerifiedUnused !== true) throw Error('Penggunaan BackgroundFetch oleh aplikasi belum diverifikasi.');
      if (app.root.DikaBackgroundFetchOwner && app.root.DikaBackgroundFetchOwner !== OWNER) throw Error('BackgroundFetch sedang digunakan integrasi lain.');
      if (typeof cap?.nativeCallback !== 'function') throw Error('Callback native BackgroundFetch tidak tersedia.');
      app.root.DikaBackgroundFetchOwner = OWNER;
      if (this.listenerId === null) {
        this.listenerId = cap.nativeCallback('BackgroundFetch', 'addListener', { eventName: 'fetch' }, (event, error) => {
          if (error) { this.lastError = 'Callback BackgroundFetch gagal.'; this.status = 'unavailable'; app.render(); return; }
          this.handleFetch(event).catch(() => {});
        });
      }
      await this.native('configure', { options: { minimumFetchInterval: 15, stopOnTerminate: true,
        startOnBoot: false, enableHeadless: false, requiredNetworkType: 0, forceAlarmManager: true } });
      // configure necessarily creates this default periodic task in the
      // supplied plugin. We own its creation after exclusive-use verification;
      // disable it immediately and retain only our named one-shot tasks.
      await this.native('stop', { taskId: 'capacitor-background-fetch' });
      this.initialized = true;
    }
    async updateSchedule(config, revision) {
      const app = this.app;
      if (revision !== this.revision) return false;
      await this.cancelOwned();
      if (revision !== this.revision) return false;
      if (app.features.trial !== true || !app.features.scheduler || !config.enabled || !app.identity || !app.engine) {
        await this.stopKeeper();
        this.status = 'disabled'; app.render(); return false;
      }
      await this.startKeeper();
      await this.initialize();
      if (revision !== this.revision) return false;
      const now = app.now(), plan = Core.notificationPlan(config, now);
      for (const job of Core.due(config, now, app.engine.ledger, app.engine.trial)) plan.unshift({ slot: job.slot, at: now + 1000 });
      for (const item of plan) {
        if (revision !== this.revision) return false;
        const taskId = `${PREFIX}${item.at}-${item.slot}`;
        this.owned.add(taskId); this.persistTasks(); // Record cleanup intent before native side effect.
        await this.native('scheduleTask', { options: { taskId, delay: Math.max(1000, item.at - app.now()),
          periodic: false, forceAlarmManager: true, stopOnTerminate: true, startOnBoot: false,
          enableHeadless: false, requiredNetworkType: 0, requiresCharging: false,
          requiresDeviceIdle: false, requiresBatteryNotLow: false } });
      }
      this.status = 'scheduled'; this.lastError = ''; app.render(); return true;
    }
    async handleFetch(event) {
      const taskId = event?.taskId;
      if (typeof taskId !== 'string' || !taskId.startsWith(PREFIX) || !this.owned.has(taskId)) return;
      const app = this.app;
      if (event.timeout === true) {
        if (this.currentTask === taskId) app.stop('needs-user', 'Waktu tugas latar belakang habis. Periksa antrean offline.');
        this.status = 'timed-out';
        await this.finish(taskId); app.render(); return;
      }
      // Duplicate delivery for a running task belongs to that same execution;
      // it must not clear its wake authority or finish it prematurely.
      if (this.waking && this.currentTask === taskId) return;
      try {
        if (this.waking || app.features.trial !== true || !app.features.scheduler || !app.engine || !app.settings().enabled ||
            (app.features.backgroundKeeper && (this.keeperId === null || this.keeperError))) return;
        this.waking = true; this.currentTask = taskId; this.lastWakeAt = app.now();
        this.lastWakeSource = 'native-background-fetch';
        this.status = 'running'; app.backgroundWake = true;
        app.connectRecorder(); app.ensureAccount();
        await app.engine?.tick();
        if (this.status === 'running') this.status = 'finished';
      } catch (error) {
        this.status = 'failed'; this.lastError = error.message || 'Tugas latar belakang berhenti.';
      } finally {
        if (this.currentTask === taskId) { this.currentTask = null; this.waking = false; app.backgroundWake = false; }
        await this.finish(taskId); app.render();
      }
    }
    async finish(taskId) {
      if (!this.owned.has(taskId)) return;
      try {
        await this.native('finish', { taskId });
        this.owned.delete(taskId); this.persistTasks();
      } catch (_) { this.lastError = 'Penyelesaian tugas native belum terkonfirmasi.'; }
    }
    async record(job) {
      const app = this.app, identity = app.identity, controller = app.controller;
      const machine = controller?.attendanceMachineService, service = app.syncService;
      if (!this.ownsWake() || !identity || app.account() !== identity || !machine || typeof machine.recordAttendance !== 'function' ||
          typeof service?.saveAttendanceToStorage !== 'function') {
        app.engine?.event(job.key, 'needs-user', 'Layanan pencatatan latar belakang belum siap.'); return;
      }
      const company = machine.auth?.companySetting;
      const settings = machine.getAttendanceSetting();
      if (company?.offlineMode !== true || settings?.takePhoto !== false ||
          FACE_FLAGS.some(flag => company?.[flag] === true || settings?.[flag] === true)) {
        app.engine.event(job.key, 'needs-user', 'Pengaturan akun memerlukan proses interaktif; gunakan GreatDay.'); return;
      }
      if (app.active || app.visible('ion-alert,ion-loading') || app.visible('app-time-attendance-preview')) {
        app.engine.event(job.key, 'needs-user', 'Proses GreatDay lain sedang berjalan.'); return;
      }
      const ticket = `${job.key}:background:${app.now()}`;
      app.active = { ticket, job, controller, identity, expires: app.now() + 90000, recordId: null, attempted: false };
      const expires = app.active.expires;
      const bounded = async work => {
        const schedule = app.root.setTimeout?.bind(app.root) || setTimeout;
        const cancel = app.root.clearTimeout?.bind(app.root) || clearTimeout;
        let timer;
        try {
          return await Promise.race([work, new Promise((_, reject) => {
            timer = schedule(() => reject(Error('Batas waktu pencatatan latar belakang berakhir.')), Math.max(1, expires - app.now()));
          })]);
        } finally { if (timer !== undefined) cancel(timer); }
      };
      app.engine.event(job.key, 'running', 'Mengambil lokasi melalui alur asli GreatDay di latar belakang.');
      let promise, params;
      app.starting = true;
      try { promise = machine.recordAttendance({ isAttendanceBarcode: false, isOnline: false, isOnCall: false }); }
      catch (_) { app.stop('needs-user', 'GreatDay tidak dapat memulai pencatatan latar belakang.'); return; }
      finally { app.starting = false; }
      try { params = await bounded(promise); }
      catch (_) { if (app.active?.ticket === ticket) app.stop('needs-user', 'Pengambilan data GreatDay berhenti. Periksa izin lokasi dan antrean.'); return; }
      const current = () => this.ownsWake() && app.active?.ticket === ticket && app.account() === identity && app.identity === identity;
      if (!current()) return;
      if (!params) { app.stop('needs-user', 'GreatDay membatalkan pencatatan latar belakang.'); return; }
      params.attOn = 'offline';
      app.captured(ticket, params); // Existing identity/ID/fresh-location validation and durable reservation.
      if (!current()) return;
      const recordedAt = Date.parse(params.datetime), timeout = Number(company.timeoutAttendance) || 5;
      if (!Number.isFinite(recordedAt) || recordedAt > app.now() + 60000 || app.now() - recordedAt >= timeout * 60000 || app.now() > app.active.expires) {
        app.stop('needs-user', 'Waktu catatan tidak valid atau proses melewati batas GreatDay.'); return;
      }
      app.active.attempted = true;
      app.engine.event(job.key, 'running', 'Meminta GreatDay menyimpan catatan offline tanpa membuka halaman.');
      let records;
      try { records = await bounded(service.saveAttendanceToStorage(params)); }
      catch (_) { if (app.active?.ticket === ticket) app.stop('needs-user', 'GreatDay gagal menyimpan catatan latar belakang. Periksa antrean.'); return; }
      if (current()) app.persisted(params, records);
      // attachPreview may already have wrapped this same native storage
      // service and observed persistence, clearing active before we resume.
      const entry = app.engine?.ledger[job.key];
      if (app.account() === identity && app.identity === identity && entry?.status === 'stored-offline' && String(entry.recordId) === String(params.id)) {
        service.responseFailed$?.next(params);
      }
    }
  }
  function attach(app) {
    if (app.features.nativeTrial) return null;
    if (app.backgroundRunner) return app.backgroundRunner;
    const runner = new Runner(app), start = app.start.bind(app);
    app.backgroundRunner = runner;
    app.start = job => runner.ownsWake() ? runner.record(job) : start(job);
    return runner;
  }
  return { attach, Runner, PREFIX };
});
