/* SPDX-License-Identifier: GPL-3.0-only */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./core.js') : root.DikaScheduleCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root.DikaOffline?.features.nativeTrial) api.attach(root.DikaOffline);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  const DEFAULT = { ...Core.DEFAULT, enabled: false, inTime: '07:00', outTime: '19:00' };
  class NativeController {
    constructor(app) {
      this.app = app; this.port = null; this.sequence = 0; this.pending = new Map();
      this.snapshot = null; this.error = ''; this.lastRead = 0; this.bound = undefined;
      this.syncing = false; this.retired = false; this.ready = false;
      this.saving = false;
      this.hasKnownAccount = false;
      this.receive = event => {
        if (event.data !== 'dika-native-attendance-v1' || !event.ports?.[0]) return;
        // Android transfers this port only to the top-level local Capacitor origin.
        // Never accept channels injected by frames or a remote web origin.
        if (!/^https?:\/\/localhost$/.test(app.root.location?.origin || '')) return;
        if (event.source != null && event.source !== app.root) return;
        if (event.origin && event.origin !== 'null' && event.origin !== app.root.location.origin) return;
        this.connect(event.ports[0]);
      };
      app.root.addEventListener?.('message', this.receive);
    }
    connect(port) {
      this.disconnect(); this.port = port; this.ready = false; this.bound = undefined;
      port.onmessage = event => {
        let data;
        try { data = JSON.parse(event.data); } catch (_) { return; }
        if (data.event === 'ping') { try { port.postMessage(JSON.stringify({ method: 'pong' })); } catch (_) {} return; }
        const request = this.pending.get(data.id);
        if (!request) return;
        this.pending.delete(data.id); clearTimeout(request.timer);
        if (data.error) request.reject(Error(data.error)); else request.resolve(data.result);
      };
      port.onmessageerror = () => this.disconnect(); port.start?.();
      this.poll(true).catch(() => {});
    }
    disconnect() {
      if (this.port) { try { this.port.close(); } catch (_) {} }
      this.port = null; this.ready = false;
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(Error('Sambungan native terputus. Buka kembali GreatDay.')); }
      this.pending.clear();
    }
    request(method, payload = {}) {
      if (!this.port) return Promise.reject(Error('Layanan native belum terhubung. Buka kembali GreatDay hasil patch terbaru.'));
      const id = ++this.sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Layanan native belum merespons. Buka kembali GreatDay.')); }, 5000);
        this.pending.set(id, { resolve, reject, timer });
        try { this.port.postMessage(JSON.stringify({ ...payload, id, method })); }
        catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    }
    async retireLegacy() {
      const app = this.app, cap = app.root.Capacitor;
      if (this.retired || typeof cap?.nativePromise !== 'function') return;
      this.retired = true;
      try {
        const tasks = JSON.parse(app.storage.getItem('dika.offline.v1.background.tasks') || '[]');
        if (Array.isArray(tasks)) for (const taskId of tasks) if (typeof taskId === 'string' && taskId.startsWith('dika-trial-offline-'))
          await cap.nativePromise('BackgroundFetch', 'stop', { taskId });
        app.storage.setItem('dika.offline.v1.background.tasks', '[]');
        await app.refreshNotifications(false); // Cancels only the old patch's notification IDs.
      } catch (_) { this.retired = false; }
    }
    async poll(force = false) {
      if (!this.port || this.syncing || this.saving || (!force && Date.now() - this.lastRead < 5000)) return;
      this.syncing = true;
      const activePort = this.port;
      try {
        const identity = this.app.account();
        let result;
        // GreatDay constructs its machine before restoring authentication. A null
        // startup identity is not evidence of logout and must not disable boot alarms.
        if (identity !== this.bound && (identity !== null || this.hasKnownAccount)) {
          result = await this.request('bindAccount', { identity: identity || '' });
          this.bound = identity;
          if (identity !== null) this.hasKnownAccount = true;
        } else result = await this.request('status');
        if (activePort !== this.port) return;
        if (!this.app.features.scheduler && !this.app.features.reminders && result.config.enabled)
          result = await this.request('configure', { config: { ...result.config, enabled: false }, identity: identity || '' });
        this.snapshot = result; this.ready = true; this.error = ''; this.lastRead = Date.now();
      } catch (error) { if (activePort === this.port) { this.error = error.message; this.ready = false; } }
      finally { this.syncing = false; this.app.render(); }
      this.retireLegacy().catch(() => {});
    }
    async configure(config) {
      if (this.saving) throw Error('Tunggu penyimpanan jadwal native selesai.');
      const valid = Core.validate(config), identity = this.app.account();
      if (valid.enabled && (!this.app.features.scheduler && !this.app.features.reminders)) throw Error('Fitur jadwal tidak dipilih.');
      if (valid.enabled && !identity) throw Error('Login GreatDay sebelum mengaktifkan jadwal native.');
      // Preferences in Android are authoritative; never replay a stale WebView draft after restart.
      this.saving = true;
      try {
        const result = await this.request('configure', { config: { ...valid, recordLocation: !!this.app.features.scheduler }, identity: identity || '' });
        if (identity !== this.app.account()) {
          this.snapshot = await this.request('bindAccount', { identity: this.app.account() || '' });
          throw Error('Akun berubah saat menyimpan. Periksa dan simpan ulang jadwal native.');
        }
        this.snapshot = result; this.ready = true; this.error = ''; this.bound = identity;
        if (identity !== null) this.hasKnownAccount = true;
        if (result.config.enabled && (!result.nextIn || !result.nextOut))
          throw Error('Preferensi tersimpan, tetapi alarm belum terdaftar. Periksa izin native dan simpan ulang.');
        this.app.notice = 'Jadwal native tersimpan. Hasil lokasi hanya dummy; hook GreatDay belum terhubung.';
      } finally { this.saving = false; this.app.render(); }
    }
    settings() { return this.snapshot?.config || { ...DEFAULT, days: [...DEFAULT.days] }; }
    diagnostics() { return this.snapshot ? { ...this.snapshot, connected: !!this.port, error: this.error } :
      { mode: 'native-dummy-trial', connected: !!this.port, error: this.error, greatDayHook: 'NOT_IMPLEMENTED', serverSendHeld: true }; }
  }
  function attach(app) {
    if (app.nativeController || !app.features.nativeTrial) return app.nativeController;
    const controller = app.nativeController = new NativeController(app);
    app.settings = () => controller.settings();
    app.configure = config => controller.configure(config);
    app.readiness = () => controller.error || (!controller.ready ? 'Menunggu sambungan native.' :
      !controller.settings().enabled ? 'Uji jadwal native nonaktif.' : 'Uji native aktif · lokasi sementara; hook GreatDay belum terhubung.');
    // No native-dummy job may enter the former real GreatDay recording path.
    app.start = async () => { throw Error('Mode uji native hanya menyimpan dummy.'); };
    app.scheduleState = () => ['in', 'out'].map(slot => ({ slot, scheduled: controller.settings()[slot + 'Time'],
      state: !controller.settings().enabled ? 'disabled' : controller.snapshot?.today?.[slot] || 'scheduled' }));
    const original = app.diagnostics.bind(app);
    app.diagnostics = () => ({ ...original(), schedule: controller.settings(), scheduleState: app.scheduleState(),
      native: controller.diagnostics(), background: null });
    return controller;
  }
  return { NativeController, attach, DEFAULT };
});
