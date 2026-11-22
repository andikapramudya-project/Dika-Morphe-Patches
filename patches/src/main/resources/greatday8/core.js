/* SPDX-License-Identifier: GPL-3.0-only */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DikaScheduleCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ZONE = 'Asia/Makassar';
  const DEFAULT = { enabled: false, zone: ZONE, days: [1, 2, 3, 4, 5], inTime: '07:30', outTime: '19:30' };
  const CATCH_UP_MS = 15 * 60000;
  const HISTORY_LIMIT = 50;
  function validate(input) {
    if (!input || typeof input.enabled !== 'boolean') throw Error('Pengaturan tidak valid');
    const validTime = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
    if (!validTime(input.inTime) || !validTime(input.outTime) || input.inTime === input.outTime) throw Error('Pilih dua waktu yang berbeda');
    if (!Array.isArray(input.days) || !input.days.length || input.days.some(d => !Number.isInteger(d) || d < 1 || d > 7)) throw Error('Pilih hari kerja');
    return { enabled: input.enabled, zone: ZONE, days: [...new Set(input.days)].sort(), inTime: input.inTime, outTime: input.outTime };
  }
  function wall(now, zone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(now)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const day = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
    return { date, day, time: `${parts.hour}:${parts.minute}`, second: +parts.second };
  }
  function slots(config, now, trial = false) {
    const w = wall(now, ZONE);
    return ['in', 'out'].map(slot => {
      const scheduled = config[slot + 'Time'];
      const scheduledAt = Date.parse(`${w.date}T${scheduled}:00+08:00`);
      return { key: `${w.date}:${slot}${trial ? ':' + scheduled : ''}`, slot, date: w.date, scheduled, scheduledAt, startedAt: now };
    });
  }
  function reservation(ledger, job, trial = false) {
    if (Object.prototype.hasOwnProperty.call(ledger, job.key)) return ledger[job.key];
    if (!trial) {
      // Final builds preserve every earlier reservation, including time-keyed
      // v0.7.1/trial attempts. Changing the clock cannot create a second slot.
      const prefix = `${job.date}:${job.slot}:`;
      const key = Object.keys(ledger).sort().find(key => key.startsWith(prefix));
      return key ? ledger[key] : null;
    }
    const legacy = ledger[`${job.date}:${job.slot}`];
    // v0.7.0 stored the scheduled time in each reservation, but omitted it
    // from the key. Keep that reservation for its original time. Incomplete
    // older entries remain blocked because their original time is unknown.
    return legacy && (!legacy.scheduled || legacy.scheduled === job.scheduled) ? legacy : null;
  }
  function due(config, now, ledger, trial = false) {
    if (!config.enabled || !config.days.includes(wall(now, ZONE).day)) return [];
    return slots(config, now, trial).filter(job => now >= job.scheduledAt && now - job.scheduledAt <= CATCH_UP_MS)
      .filter(job => !reservation(ledger, job, trial));
  }
  // The supported Indonesian time zones have fixed offsets and no DST.
  function notificationPlan(config, now) {
    if (!config.enabled) return [];
    const w = wall(now, ZONE), result = [];
    for (let day = 0; day < 14; day++) {
      const d = new Date(`${w.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + day);
      if (!config.days.includes(d.getUTCDay() || 7)) continue;
      for (const slot of ['in', 'out']) {
        const [h, m] = config[slot + 'Time'].split(':').map(Number);
        const at = d.getTime() + (h - 8) * 3600000 + m * 60000;
        if (at > now) result.push({ at, slot });
      }
    }
    return result;
  }
  class Engine {
    constructor({ load, save, now = Date.now, run, ready = () => true, changed = () => {}, trial = false }) {
      this.save = save; this.now = now; this.run = run; this.ready = ready; this.changed = changed; this.busy = false;
      this.trial = trial === true;
      const data = load() || {};
      this.config = validate({ ...DEFAULT, ...(data.config || {}) });
      this.ledger = data.ledger || {}; this.history = Array.isArray(data.history) ? data.history.slice(-HISTORY_LIMIT) : [];
      for (const item of Object.values(this.ledger)) {
        if (item.status === 'running') {
          item.status = 'interrupted';
          this.history.push({ at: this.now(), key: item.key, status: 'interrupted', message: 'Sesi sebelumnya terputus. Periksa daftar offline; tidak dicoba ulang otomatis.' });
        }
      }
      this.history = this.history.slice(-HISTORY_LIMIT);
    }
    persist() { this.save({ config: this.config, ledger: this.ledger, history: this.history }); this.changed(); }
    configure(config) { this.config = validate(config); this.persist(); }
    clearHistory() {
      if (this.busy) throw Error('Tunggu proses absensi selesai.');
      const history = this.history;
      this.history = [];
      try { this.persist(); } catch (error) { this.history = history; throw error; }
    }
    resetTrial(slot) {
      if (!this.trial) throw Error('Reset percobaan hanya tersedia pada build uji.');
      if (slot !== 'in' && slot !== 'out') throw Error('Pilih masuk atau pulang.');
      if (this.busy) throw Error('Tunggu proses absensi selesai.');
      const date = wall(this.now(), ZONE).date, prefix = `${date}:${slot}`;
      const ledger = this.ledger, history = this.history;
      const keys = Object.keys(ledger).filter(key => key === prefix || key.startsWith(prefix + ':'));
      this.ledger = Object.fromEntries(Object.entries(ledger).filter(([key]) => !keys.includes(key)));
      this.history = [...history, { at: this.now(), key: prefix, slot, status: 'reset-test',
        message: 'Pengunci percobaan direset untuk uji; catatan GreatDay tetap disimpan.' }].slice(-HISTORY_LIMIT);
      try { this.persist(); } catch (error) { this.ledger = ledger; this.history = history; throw error; }
      return keys.length;
    }
    event(key, status, message) {
      if (this.ledger[key]) this.ledger[key].status = status;
      const entry = this.ledger[key];
      this.history.push({ at: this.now(), key, slot: entry?.slot, scheduled: entry?.scheduled, status, message }); this.history = this.history.slice(-HISTORY_LIMIT);
      this.persist();
    }
    async tick() {
      if (this.busy) return;
      const jobs = due(this.config, this.now(), this.ledger, this.trial);
      if (!jobs.length) return;
      this.busy = true;
      try {
        const job = jobs[0];
        // Waiting for services has no recording side effect and must not consume the slot.
        if (!this.ready(job)) return;
        // Persist the reservation BEFORE any side effect. An interrupted attempt
        // is never retried automatically, even if the save result is unknown.
        this.ledger[job.key] = { ...job, status: 'running' };
        const keys = Object.keys(this.ledger).sort();
        while (keys.length > 180) delete this.ledger[keys.shift()];
        this.persist();
        try { await this.run(job); }
        catch (_) { this.event(job.key, 'needs-user', 'Percobaan berhenti; periksa catatan GreatDay sebelum mencoba manual.'); }
      } finally { this.busy = false; }
    }
  }
  return { ZONE, DEFAULT, CATCH_UP_MS, HISTORY_LIMIT, validate, wall, slots, reservation, due, notificationPlan, Engine };
});
