/* SPDX-License-Identifier: GPL-3.0-only */
(function (root) {
  'use strict';
  const Core = typeof module === 'object' && module.exports ? require('./core.js') : root.DikaScheduleCore;
  // Queued GreatDay records are plain objects with a stable string id.
  const r_id = item => (item && (typeof item.id === 'string' || typeof item.id === 'number')) ? String(item.id) : null;
  const PREFIX = 'dika.offline.v1.';
  // v0.5.0: signature-check bypass. Morphe re-signs patched APKs, so the
  // bundled AntiTampering signature check would abort startup with the
  // "modified by another party" warning. Answer exactly that one native
  // call; every other plugin and every other detection stays untouched.
  function installSignatureBypass(scope) {
    const target = scope || root;
    let attempts = 0;
    const wrap = () => {
      const cap = target.Capacitor;
      if (!cap || typeof cap.nativePromise !== 'function' || cap.__dikaSignatureBypass) return !!cap?.__dikaSignatureBypass;
      try {
        const original = cap.nativePromise.bind(cap);
        cap.nativePromise = function (plugin, method, options) {
          if (plugin === 'AntiTampering' && method === 'verify') return Promise.resolve({ status: 'OK' });
          return original(plugin, method, options);
        };
        cap.__dikaSignatureBypass = true;
        return true;
      } catch (_) { return false; }
    };
    if (wrap()) return;
    const timer = target.setInterval ? target.setInterval : setInterval;
    const poll = timer(() => { if (wrap() || ++attempts > 40) clearInterval(poll); }, 250);
  }
  const PREFERENCES = PREFIX + 'preferences';
  const PREVIEW_ROUTE = '/hr/attendance/attendance-record-time/time-attendance-preview';
  const NOTIFICATION_BASE = 1734100000;
  class Integration {
    constructor(env = {}) {
      this.root = env.root || root; this.doc = env.document || root.document;
      this.storage = env.storage || root.localStorage; this.now = env.now || Date.now;
      this.controller = null; this.engine = null; this.identity = null;
      this.machine = null; this.navigation = null; this.automaticController = null;
      this.active = null; this.preview = null; this.starting = false;
      this.observed = new WeakSet(); this.notice = ''; this.notificationRevision = 0;
      this.render = () => {};
      this.features = { scheduler: true, reminders: true, sendGate: false, diagnostics: false, trial: false, ...(this.root.DikaFeatures || {}), ...(env.features || {}) };
      this.trial = this.features.trial === true;
      this.queueIds = null; this.queueCheckedAt = null; this.queueReading = false;
      this.notificationQueue = Promise.resolve();
      this.draft = { ...Core.DEFAULT, days: [...Core.DEFAULT.days] };
    // v0.3.0: send gate. Records stay queued until the user confirms.
    this.syncService = null; this.pending = null; this.approvals = {};
    this.approvalKey = null; this.onPending = () => {};
      try {
        const saved = JSON.parse(this.storage.getItem(PREFERENCES) || 'null');
        if (saved) this.draft = Core.validate(saved);
      } catch (_) { this.notice = 'Pengaturan sebelumnya tidak dapat dibaca.'; }
    }
    account(controller = this.controller) {
      const auth = (this.machine || controller?.attendanceMachineService)?.auth?.gdAuth;
      if (!auth || !auth.id || !(auth.userId || auth.empId)) return null;
      return JSON.stringify([String(auth.id), String(auth.userId || auth.empId)]);
    }
    attachOffline(controller) {
      this.controller = controller;
      this.machine = controller?.attendanceMachineService || this.machine;
      this.ensureAccount();
    }
    attachMachine(machine) {
      this.machine = machine;
      this.connectRecorder(); this.ensureAccount();
    }
    attachNavigation(navigation) {
      this.navigation = navigation;
      this.connectRecorder(); this.ensureAccount();
    }
    connectRecorder() {
      const machine = this.machine, nav = this.navigation;
      if (!machine || !nav || typeof machine.recordAttendance !== 'function' || typeof nav.push !== 'function') return;
      if (nav.deviceService?.isNative !== true || nav.responsiveService?.getIsMobile() !== true) return;
      if (this.automaticController?.attendanceMachineService === machine && this.automaticController.navigation === nav) return;
      const integration = this;
      const controller = { attendanceMachineService: machine, navigation: nav,
        async recordAttendance(barcode) {
          const ticket = integration.ticketFor(controller);
          // Same flags and native-mobile navigation as the supplied APK's
          // original offline action. No network state, checks or time is faked.
          const params = await machine.recordAttendance({ isAttendanceBarcode: barcode, isOnline: false, isOnCall: false });
          if (!params) { if (integration.active?.ticket === ticket) integration.stop('needs-user', 'Pencatatan dibatalkan.'); return; }
          if (!ticket || integration.active?.ticket !== ticket || integration.account() !== integration.active.identity) return;
          params.attOn = 'offline';
          integration.captured(ticket, params);
          if (integration.active?.ticket === ticket) {
            // Like the original offline action, start navigation without
            // awaiting its dismissal Promise (which can remain pending until
            // a later route event). Do not keep the scheduler busy for it.
            Promise.resolve(nav.push(PREVIEW_ROUTE, params, { indexPage: true })).catch(() => {
              if (integration.active?.ticket === ticket) integration.stop('needs-user', 'Preview belum terbuka. Periksa GreatDay.');
            });
          }
        }
      };
      this.automaticController = this.controller = controller;
    }
    requiresLocation(machine) {
      return !!this.active && this.active.controller.attendanceMachineService === machine && this.account() === this.active.identity;
    }
    attachSync(service) { this.syncService = service; }
    async refreshQueue(force = false) {
      const identity = this.identity, service = this.syncService;
      if (!identity || !service?.baseStorage?.getGreatdayStorage || this.queueReading) return;
      if (!force && this.queueCheckedAt !== null && this.now() - this.queueCheckedAt < 5000) return;
      this.queueReading = true;
      try {
        // Target 1.79.1 storage enum: GDAttendanceOffline = 9 (verified in shared chunk).
        const records = await service.baseStorage.getGreatdayStorage(9);
        if (identity !== this.identity || service !== this.syncService) return;
        if (records != null && !Array.isArray(records)) throw Error('Invalid offline queue');
        this.queueIds = (records || []).map(r_id).filter(Boolean);
        this.queueCheckedAt = this.now();
        for (const item of Object.values(this.engine?.ledger || {})) {
          if (item.status === 'interrupted' && item.recordId && this.queueIds.includes(String(item.recordId))) {
            this.engine.event(item.key, 'stored-offline', 'Catatan ditemukan dalam antrean asli GreatDay.');
          }
        }
      } catch (_) { if (identity === this.identity) { this.queueIds = null; this.queueCheckedAt = this.now(); } }
      finally { this.queueReading = false; this.render(); }
    }
    readiness() {
      if (!this.features.scheduler) return 'Pencatatan otomatis tidak dipilih.';
      if (!this.identity || !this.engine) return 'Menunggu akun GreatDay.';
      if (!this.engine.config.enabled) return 'Absen otomatis nonaktif.';
      const c = this.controller, machine = c?.attendanceMachineService;
      if (!c || typeof c.recordAttendance !== 'function') return 'Menunggu layanan absensi.';
      if (machine?.auth?.companySetting?.offlineMode !== true) return 'Menunggu izin mode offline GreatDay.';
      // Location-only automation follows the real company setting; never switches it off.
      let settings;
      try { settings = machine.getAttendanceSetting?.(); }
      catch (_) { return 'Menunggu pengaturan GreatDay.'; }
      if (!settings || settings.takePhoto !== false) return 'Otomatisasi lokasi memerlukan pengaturan GreatDay tanpa foto.';
      if (this.doc.visibilityState !== 'visible' && !this.backgroundRunner?.ownsWake()) return 'Menunggu aplikasi dibuka.';
      if (this.active || this.visible('ion-alert,ion-loading') || this.visible('app-time-attendance-preview')) return 'Menunggu proses GreatDay selesai.';
      return '';
    }
    saveApprovals() {
      try { this.storage.setItem(this.approvalKey, JSON.stringify(this.approvals)); }
      catch (_) { /* approvals are best effort; a failure only re-prompts. */ }
    }
    // Called from the patched entry of attendanceSyncService.syncAttendanceOffline(w).
    // Returns false to hold the queue until confirmSend() approves exactly these ids.
    syncGate(records, service) {
      if (service && typeof service.syncAttendanceOffline === 'function') this.syncService = service;
      this.ensureAccount();
      if (this.trial) {
        // A test APK never dispatches records, even if an older install left
        // approvals behind or the optional send gate was not selected.
        this.approvals = {};
        if (this.approvalKey) this.saveApprovals();
        if (this.identity && Array.isArray(records) && records.length) {
          const ids = records.map(r_id).filter(Boolean);
          this.pending = { ids, records: [], requestedAt: this.now() };
          this.render();
        }
        return false;
      }
      if (!this.features.sendGate) return true;
      if (!this.identity) return false;
      if (!Array.isArray(records) || !records.length) return true;
      const ids = records.map(item => item && r_id(item)).filter(Boolean);
      if (!ids.length) return false;
      if (!this.approvalKey) this.ensureAccount();
      const approved = this.approvals || {};
      const remaining = ids.filter(id => approved[id] !== true);
      if (!remaining.length) { for (const id of ids) delete approved[id]; this.saveApprovals(); return true; }
      const same = this.pending && this.pending.ids.length === remaining.length &&
        this.pending.ids.every((id, i) => id === remaining[i]);
      if (!same) {
        this.pending = { ids: remaining, records: records.filter(item => remaining.includes(item && r_id(item))),
          requestedAt: this.now() };
        this.render();
        try { this.onPending(this.pending); } catch (_) { /* UI is optional. */ }
      }
      return false;
    }
    confirmSend() {
      if (this.trial) { this.notice = 'Build uji menahan seluruh pengiriman ke server.'; this.render(); return false; }
      const pending = this.pending, service = this.syncService;
      if (!pending || !service || typeof service.syncAttendanceOffline !== 'function') return false;
      for (const id of pending.ids) this.approvals[id] = true;
      this.saveApprovals();
      const records = pending.records.slice();
      this.pending = null; this.render();
      // The host removes delivered records from the queue itself; we never edit it.
      Promise.resolve(service.syncAttendanceOffline(records)).catch(() => {});
      return true;
    }
    deferSend() { this.pending = null; this.render(); }
    get pendingCount() { return this.pending ? this.pending.ids.length : 0; }
    clearHistory() {
      if (!this.engine || this.active || this.engine.busy) throw Error('Tunggu proses absensi selesai dan akun siap.');
      this.engine.clearHistory();
      this.notice = 'Riwayat dibersihkan. Pengunci dan catatan GreatDay tetap disimpan.';
      this.render();
    }
    resetTrial(slot) {
      if (!this.trial) throw Error('Reset percobaan hanya tersedia pada build uji.');
      if (!this.engine || !this.identity || this.active || this.engine.busy) throw Error('Tunggu proses absensi selesai dan akun siap.');
      const count = this.engine.resetTrial(slot);
      this.backgroundRunner?.configureSchedule(true).catch(() => {});
      this.notice = 'Percobaan direset. Catatan offline GreatDay tetap disimpan.';
      this.render(); return count;
    }
    scheduleState() {
      const config = this.settings(), now = this.now();
      return Core.slots(config, now, this.trial).map(job => {
        const entry = Core.reservation(this.engine?.ledger || {}, job, this.trial);
        let state = !config.enabled ? 'disabled' : !config.days.includes(Core.wall(now, Core.ZONE).day) ? 'off-day' :
          !this.features.scheduler ? 'reminder' :
          now < job.scheduledAt ? 'scheduled' : now - job.scheduledAt > Core.CATCH_UP_MS ? 'missed' : 'waiting';
        if (entry) state = entry.status;
        // A historical save is evidence of local persistence only. If its ID
        // has left the queue we cannot infer server acceptance or deletion.
        if (entry?.status === 'stored-offline') {
          state = this.queueIds === null || !entry.recordId ? 'saved-unchecked' :
            this.queueIds.includes(String(entry.recordId)) ? 'queued' : 'queue-missing';
        }
        if (!this.trial && entry?.scheduled && entry.scheduled !== job.scheduled) state = 'already-attempted';
        return { key: job.key, slot: job.slot, scheduled: job.scheduled, state,
          attemptKey: entry?.key || null, attemptScheduled: entry?.scheduled || null, recordId: entry?.recordId || null };
      });
    }
    // Snapshot of scheduler state for the in-app diagnostics screen and
    // export. Never includes auth payloads, record contents or storage keys.
    diagnostics() {
      return {
        zone: Core.ZONE,
        trialBuild: this.trial,
        serverSendHeld: this.trial,
        historyLimit: Core.HISTORY_LIMIT,
        schedule: this.engine ? { ...this.engine.config } : { ...this.draft },
        accountKnown: !!this.identity,
        engineReady: !!this.engine,
        controllerReady: !!this.controller,
        readiness: this.readiness(),
        background: this.backgroundRunner?.diagnostics() || null,
        scheduleState: this.scheduleState(),
        queueIds: this.queueIds === null ? null : [...this.queueIds],
        queueCheckedAt: this.queueCheckedAt,
        syncServiceAvailable: !!this.syncService,
        pendingIds: this.pending ? [...this.pending.ids] : [],
        pendingRequestedAt: this.pending ? this.pending.requestedAt : null,
        signatureBypassInstalled: !!(this.root.Capacitor && this.root.Capacitor.__dikaSignatureBypass),
        notice: this.notice,
        history: (this.engine?.history || []).slice(-50)
      };
    }
    settings() { return this.engine?.config || this.draft; }
    ensureAccount() {
      const identity = this.account();
      if (identity === this.identity) return;
      if (this.active) this.stop('needs-user', 'Akun berubah; periksa catatan GreatDay.');
      this.identity = identity; this.engine = null; this.preview = null;
      this.pending = null; this.approvals = {}; this.approvalKey = null;
      this.queueIds = null; this.queueCheckedAt = null;
      this.refreshNotifications(false).catch(() => {});
      if (!identity) { this.render(); return; }
      const key = PREFIX + encodeURIComponent(identity);
      this.approvalKey = PREFIX + 'sync.' + encodeURIComponent(identity);
      try {
        const savedApprovals = JSON.parse(this.storage.getItem(this.approvalKey) || '{}');
        this.approvals = savedApprovals && typeof savedApprovals === 'object' ? savedApprovals : {};
      } catch (_) { this.approvals = {}; }
      try {
        this.engine = new Core.Engine({
          load: () => JSON.parse(this.storage.getItem(key) || 'null') || { config: { ...this.draft, enabled: false } },
          save: value => this.storage.setItem(key, JSON.stringify(value)),
          now: this.now, run: job => this.start(job), ready: () => !this.readiness(), changed: () => this.render(), trial: this.trial
        });
        // Validate that local state is writable BEFORE permitting any recording.
        this.engine.persist(); this.notice = '';
      } catch (_) { this.engine = null; this.notice = 'Penyimpanan jadwal tidak tersedia. Otomatisasi dinonaktifkan.'; }
      if (this.engine?.config.enabled) this.refreshNotifications(false).catch(() => {});
      this.render();
    }
    ticketFor(controller) {
      return this.starting && this.active?.controller === controller ? this.active.ticket : null;
    }
    captured(ticket, params) {
      const active = this.active;
      if (!active || ticket !== active.ticket || this.account() !== active.identity) return;
      if (!params || !params.id || params.attOn !== 'offline' || params.isForceValidation) {
        this.stop('needs-user', 'Hasil pencatatan tidak sesuai alur offline yang didukung.'); return;
      }
      active.recordId = params.id;
      const location = params.geolocation;
      if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
          Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180 ||
          (location.latitude === 0 && location.longitude === 0) || location.cacheLocation === true) {
        this.stop('needs-user', 'Lokasi aktual belum tersedia. Aktifkan lokasi lalu periksa absensi.'); return;
      }
      const entry = this.engine?.ledger[active.job.key];
      if (entry) { entry.recordId = String(params.id); this.engine.persist(); }
    }
    attachPreview(preview) {
      this.preview = preview;
      const service = preview?.attendanceSyncService;
      if (service) this.attachSync(service);
      if (!service || this.observed.has(service) || typeof service.saveAttendanceToStorage !== 'function') return;
      const original = service.saveAttendanceToStorage, integration = this;
      service.saveAttendanceToStorage = async function (...args) {
        let result;
        try { result = await original.apply(this, args); }
        catch (error) {
          try { integration.storageFailed(args[0]); } catch (_) { /* Preserve the original error. */ }
          throw error;
        }
        try { integration.persisted(args[0], result); } catch (_) { /* Never change the host result. */ }
        return result;
      };
      this.observed.add(service);
    }
    storageFailed(params) {
      if (this.active?.recordId === params?.id) this.stop('needs-user', 'GreatDay gagal menyimpan. Periksa daftar offline sebelum mencoba lagi.');
    }
    persisted(params, records) {
      const active = this.active;
      if (!active || this.account() !== active.identity || params?.id !== active.recordId) return;
      if (!Array.isArray(records) || !records.some(x => x?.id === active.recordId)) {
        this.stop('needs-user', 'Hasil penyimpanan tidak dapat dikonfirmasi. Periksa daftar offline.'); return;
      }
      this.stop('stored-offline', 'Tersimpan melalui antrean offline GreatDay. Belum berarti diterima server.');
      this.queueIds = records.map(r_id).filter(Boolean); this.queueCheckedAt = this.now(); this.render();
    }
    visible(selector) {
      return Array.from(this.doc.querySelectorAll(selector)).some(el =>
        el.getClientRects().length > 0 && !el.closest('.ion-page-hidden,[hidden],[aria-hidden="true"]'));
    }
    async start(job) {
      if (!this.engine || !this.identity || this.doc.visibilityState !== 'visible') {
        this.engine?.event(job.key, 'needs-user', 'Aplikasi tidak aktif. Buka GreatDay dan periksa absensi.'); return;
      }
      const c = this.controller, machine = c?.attendanceMachineService;
      if (!c || this.account(c) !== this.identity || typeof c.recordAttendance !== 'function' ||
          machine?.auth?.companySetting?.offlineMode !== true) {
        this.engine.event(job.key, 'needs-user', 'Alur offline belum siap atau belum diizinkan pengaturan perusahaan.'); return;
      }
      if (this.active || this.visible('ion-alert,ion-loading') || this.visible('app-time-attendance-preview')) {
        this.engine.event(job.key, 'needs-user', 'Ada proses lain yang sedang berjalan. Periksa absensi secara manual.'); return;
      }
      this.active = { ticket: `${job.key}:${this.now()}`, job, controller: c, identity: this.identity,
        expires: this.now() + 90000, recordId: null, attempted: false };
      this.preview = null;
      this.engine.event(job.key, 'running', 'Mengambil lokasi melalui alur offline GreatDay.');
      this.starting = true;
      let result;
      try { result = c.recordAttendance(false); } finally { this.starting = false; }
      await result;
      // The host catches its own errors; only its successful persistence is
      // evidence of success. A resolved controller promise is NOT sufficient.
    }
    stop(status, message) {
      const active = this.active; this.active = null; this.starting = false;
      if (active) this.engine?.event(active.job.key, status, message);
    }
    async advance() {
      const active = this.active, p = this.preview;
      if (!active) return;
      if (this.account() !== active.identity || this.now() > active.expires) {
        this.stop('needs-user', 'Batas percobaan berakhir. Periksa daftar offline; tidak ada percobaan ulang otomatis.'); return;
      }
      if (this.doc.visibilityState !== 'visible' || active.attempted || !p || !active.recordId) return;
      if (!this.visible('app-time-attendance-preview') || this.visible('ion-alert,ion-loading')) return;
      if (p.params?.id !== active.recordId || p.params.attOn !== 'offline' || p.params.isForceValidation) return;
      if (p.attendanceMachineService !== active.controller.attendanceMachineService) return;
      if (p.disableBtnSaveAttendance !== false) return;
      // In this fingerprinted target, saveAttendance ignores its button argument
      // when attOn is offline and calls saveOfflineAttendance directly. The
      // online getButtonAttendance request is not an offline-save prerequisite.
      if (p.isValidTime !== true || typeof p.saveAttendance !== 'function') return;
      const settings = p.attendanceMachineService.getAttendanceSetting();
      if (!settings || settings.takePhoto !== false) return;
      // Retain host button/validation guards, but do not wait for unused photo processing.
      // Persist the intent before invoking the unmodified host save handler.
      active.attempted = true;
      this.engine.event(active.job.key, 'running', 'Meminta GreatDay menyimpan catatan offline.');
      try { await p.saveAttendance(0); }
      catch (_) { this.stop('needs-user', 'Penyimpanan berhenti. Periksa daftar offline GreatDay.'); }
    }
    async poll() {
      try {
        this.connectRecorder();
        this.ensureAccount();
        if (this.features.nativeTrial) {
          await this.nativeController?.poll();
          await this.refreshQueue(); this.render(); return;
        }
        if (!this.engine) return;
        this.backgroundRunner?.configureSchedule().catch(() => {});
        await this.refreshQueue();
        if (this.doc.visibilityState === 'visible' || this.backgroundRunner?.ownsWake()) await this.engine.tick();
        else await this.backgroundRunner?.pollHidden();
        await this.advance();
        this.render();
      } catch (_) {
        // Disable this session on persistence failures; no untracked side effects.
        this.active = null; this.engine = null;
        this.notice = 'Otomatisasi berhenti karena kesalahan lokal. Periksa catatan GreatDay.'; this.render();
      }
    }
    async native(method, options = {}) {
      const cap = this.root.Capacitor;
      if (typeof cap?.nativePromise !== 'function') throw Error('Native notifications unavailable');
      return cap.nativePromise('LocalNotifications', method, options);
    }
    refreshNotifications(requestPermission) {
      const revision = ++this.notificationRevision;
      const work = this.notificationQueue.catch(() => {}).then(() => this.updateNotifications(requestPermission, revision));
      this.notificationQueue = work;
      return work;
    }
    async updateNotifications(requestPermission, revision) {
      if (revision !== this.notificationRevision) return;
      const pending = await this.native('getPending');
      if (revision !== this.notificationRevision) return;
      const ours = (pending.notifications || []).filter(n => n.id >= NOTIFICATION_BASE && n.id < NOTIFICATION_BASE + 28);
      if (ours.length) await this.native('cancel', { notifications: ours.map(n => ({ id: n.id })) });
      if (revision !== this.notificationRevision || this.features.nativeTrial || !this.features.reminders || !this.engine?.config.enabled) return;
      const permission = await this.native(requestPermission ? 'requestPermissions' : 'checkPermissions');
      if (revision !== this.notificationRevision) return;
      if (permission.display !== 'granted') { this.notice = 'Notifikasi belum diizinkan. Jadwal latar belakang tidak akan mengingatkan Anda.'; this.render(); return; }
      const plan = Core.notificationPlan(this.engine.config, this.now());
      const notifications = plan.map((item, i) => ({ id: NOTIFICATION_BASE + i,
        title: `Absen ${item.slot === 'in' ? 'masuk' : 'pulang'}`,
        body: 'Buka GreatDay untuk mencatat kehadiran.',
        schedule: { at: new Date(item.at), allowWhileIdle: true }, extra: { dikaOffline: true } }));
      if (notifications.length) await this.native('schedule', { notifications });
      // A newer disable/account switch may have happened during native work.
      if (revision !== this.notificationRevision) {
        await this.native('cancel', { notifications: notifications.map(n => ({ id: n.id })) });
        return;
      }
      this.notice = 'Jadwal dan pengingat tersimpan.'; this.render();
    }
    async configure(config) {
      this.ensureAccount();
      const valid = Core.validate(config);
      if (this.active) throw Error('Tunggu proses absensi selesai sebelum mengubah jadwal.');
      // Times and days can always be saved, including before a host controller
      // is available. Enabling recording remains scoped to a known account.
      this.draft = this.engine ? valid : { ...valid, enabled: false };
      this.storage.setItem(PREFERENCES, JSON.stringify(this.draft));
      if (!this.engine) { this.notice = 'Jadwal tersimpan. Login untuk mengaktifkan.'; this.render(); return; }
      this.engine.configure(valid);
      this.backgroundRunner?.configureSchedule(true).catch(() => {});
      this.notice = 'Jadwal tersimpan.'; this.render();
      // Native permission prompts must never hold the Save button hostage.
      this.refreshNotifications(true).catch(() => {
        this.notice = 'Jadwal tersimpan. Izin pengingat belum tersedia.'; this.render();
      });
    }
  }
  if (typeof module === 'object' && module.exports) { module.exports = { Integration, NOTIFICATION_BASE, installSignatureBypass }; return; }
  installSignatureBypass(root);
  root.DikaOffline = new Integration();
})(typeof globalThis !== 'undefined' ? globalThis : this);
