const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../patches/src/main/resources/greatday8/core.js');
const { Integration, installSignatureBypass } = require('../patches/src/main/resources/greatday8/runtime.js');
const NOW = Date.parse('2026-11-06T00:00:10Z'); // Friday, 08:00 WITA
const config = { ...Core.DEFAULT, enabled: true, inTime: '08:00', outTime: '21:55' };

test('schedule uses WITA, workdays, and a bounded catch-up window', () => {
  assert.equal(Core.due(config, NOW, {}).length, 1);
  assert.equal(Core.due({ ...config, zone: 'Asia/Jakarta' }, NOW, {}).length, 1); // WITA is fixed.
  assert.equal(Core.due({ ...config, days: [1] }, NOW, {}).length, 0);
  assert.equal(Core.due(config, NOW + 60000, {}).length, 1);
  assert.equal(Core.due({ ...config, enabled: false }, NOW, {}).length, 0);
  assert.equal(Core.wall(Date.parse('2026-11-05T16:00:00Z'), config.zone).date, '2026-11-06');
});
test('invalid, duplicate and empty schedules are rejected', () => {
  for (const bad of [{ inTime: '25:00' }, { days: [] }, { days: [0] }, { outTime: config.inTime }]) {
    assert.throws(() => Core.validate({ ...config, ...bad }));
  }
  assert.equal(Core.validate({ ...config, zone: 'UTC' }).zone, 'Asia/Makassar');
});
test('at most once per scheduled time survives concurrent polling and restart', async () => {
  let data, calls = 0, unblock;
  const options = { trial: true, load: () => data, save: d => { data = JSON.parse(JSON.stringify(d)); }, now: () => NOW,
    run: () => { calls++; return new Promise(resolve => { unblock = resolve; }); } };
  const e = new Core.Engine(options); e.configure(config);
  const first = e.tick(); await e.tick(); assert.equal(calls, 1);
  assert.equal(data.ledger['2026-11-06:in:08:00'].status, 'running');
  const restarted = new Core.Engine({ ...options, run: () => { calls++; } });
  assert.equal(restarted.ledger['2026-11-06:in:08:00'].status, 'interrupted');
  await restarted.tick(); assert.equal(calls, 1);
  e.configure({ ...config, inTime: '08:01' });
  unblock(); await first;
  e.now = () => NOW + 60000; e.run = () => { calls++; }; await e.tick(); assert.equal(calls, 2);
  e.configure(config); await e.tick(); assert.equal(calls, 2);
});
test('a storage reservation failure prevents recording entirely', async () => {
  let calls = 0;
  const e = new Core.Engine({ load: () => ({ config }), save: () => { throw Error('full'); }, now: () => NOW, run: () => { calls++; } });
  await assert.rejects(e.tick()); assert.equal(calls, 0);
});
test('notification dates are future-only, bounded, and in WITA', () => {
  const plan = Core.notificationPlan(config, NOW);
  assert.ok(plan.length <= 28 && plan.length > 0);
  assert.ok(plan.every(n => n.at > NOW));
  assert.equal(plan[0].slot, 'out');
  assert.equal(Core.wall(plan[0].at, config.zone).time, '21:55');
  assert.equal(Core.notificationPlan({ ...config, enabled: false }, NOW).length, 0);
});

function fixture({ allowed = true, visible = true, failStore = false, trial = true } = {}) {
  let now = NOW;
  const map = new Map(), doc = { visibilityState: visible ? 'visible' : 'hidden', querySelectorAll: () => [] };
  const app = new Integration({ root: {}, document: doc, now: () => now, features: { trial },
    storage: { getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, v) } });
  app.refreshNotifications = async () => {};
  const machine = { auth: { gdAuth: { id: 'company-test', userId: 'user-test' }, companySetting: { offlineMode: allowed } },
    getAttendanceSetting: () => ({ takePhoto: false }) };
  let calls = 0, saves = 0;
  const service = { saveAttendanceToStorage: async params => { saves++; if (failStore) throw Error('store failed'); return [params]; } };
  const controller = { attendanceMachineService: machine,
    recordAttendance(barcode) { calls++; assert.equal(barcode, false);
      const ticket = app.ticketFor(controller);
      app.captured(ticket, { id: 'new-record', attOn: 'offline', geolocation: { latitude: -5.1, longitude: 119.4 } });
      return Promise.resolve();
    } };
  app.attachOffline(controller); app.engine.configure(config);
  const preview = { params: { id: 'new-record', attOn: 'offline', geolocation: { latitude: -5.1, longitude: 119.4 } }, attendanceMachineService: machine,
    attendanceSyncService: service, attendancePreviewService: {},
    disableBtnSaveAttendance: false, showSaveAttendance: true, btnSave: true, isValidTime: true,
    saveAttendance: async () => service.saveAttendanceToStorage(preview.params) };
  return { app, controller, preview, doc, machine, service, calls: () => calls, saves: () => saves,
    setNow: n => { now = n; }, activatePreview() { app.attachPreview(preview); app.visible = sel => sel === 'app-time-attendance-preview'; } };
}
test('only the native persisted result produces stored-offline status', async () => {
  const f = fixture(); await f.app.poll();
  assert.equal(f.calls(), 1); assert.equal(f.app.engine.ledger['2026-11-06:in:08:00'].status, 'running');
  f.activatePreview(); await f.app.poll();
  assert.equal(f.saves(), 1); assert.equal(f.app.engine.ledger['2026-11-06:in:08:00'].status, 'stored-offline');
  await f.app.poll(); assert.equal(f.saves(), 1);
});
test('hidden WebView waits and a manual opening catches up one minute later', async () => {
  const f = fixture({ visible: false }); await f.app.poll(); assert.equal(f.calls(), 0);
  f.setNow(NOW + 60000); f.doc.visibilityState = 'visible'; await f.app.poll(); assert.equal(f.calls(), 1);
});
test('company offline permission is required', async () => {
  const f = fixture({ allowed: false }); await f.app.poll(); assert.equal(f.calls(), 0);
  assert.equal(f.app.engine.ledger['2026-11-06:in:08:00'], undefined);
});
test('manual or unrelated records cannot be attributed to an automatic attempt', async () => {
  const f = fixture(); await f.app.poll();
  f.app.captured(null, { id: 'manual', attOn: 'offline' });
  assert.equal(f.app.active.recordId, 'new-record');
  f.app.persisted({ id: 'manual' }, [{ id: 'manual' }]);
  assert.equal(f.app.engine.ledger['2026-11-06:in:08:00'].status, 'running');
});
test('photo requirements, host button guards, online mode and wrong record prevent auto-save', async () => {
  const mutations = [
    f => { f.preview.disableBtnSaveAttendance = true; },
    f => { f.preview.params.attOn = 'online'; },
    f => { f.preview.params.id = 'other'; },
    f => { f.preview.isValidTime = false; },
    f => { f.machine.getAttendanceSetting = () => ({ takePhoto: true }); }
  ];
  for (const change of mutations) {
    const f = fixture(); await f.app.poll(); f.activatePreview(); change(f); await f.app.poll(); assert.equal(f.saves(), 0);
  }
});
test('failed native storage is not reported as success or retried', async () => {
  const f = fixture({ failStore: true }); await f.app.poll(); f.activatePreview(); await f.app.poll();
  assert.equal(f.app.engine.ledger['2026-11-06:in:08:00'].status, 'needs-user');
  await f.app.poll(); assert.equal(f.saves(), 1); assert.equal(f.calls(), 1);
});
test('account changes cancel the active attempt and do not inherit enabled schedules', async () => {
  const f = fixture(); await f.app.poll(); f.activatePreview();
  const previous = f.app.engine;
  f.machine.auth.gdAuth.userId = 'other-user'; await f.app.poll();
  assert.equal(f.saves(), 0); assert.equal(f.app.engine.config.enabled, false);
  assert.equal(previous.ledger['2026-11-06:in:08:00'].status, 'needs-user');
});
test('a late preview never triggers delayed automatic saving', async () => {
  const f = fixture(); await f.app.poll(); f.activatePreview(); f.setNow(NOW + 91000); await f.app.poll();
  assert.equal(f.saves(), 0); assert.equal(f.app.engine.ledger['2026-11-06:in:08:00'].status, 'needs-user');
});
test('notification disable operations are serialized and cancel only owned ids', async () => {
  const f = fixture(), operations = [];
  const { NOTIFICATION_BASE } = require('../patches/src/main/resources/greatday8/runtime.js');
  f.app.refreshNotifications = Integration.prototype.refreshNotifications;
  f.app.native = async (method, value) => {
    operations.push([method, value]);
    if (method === 'getPending') return { notifications: [{ id: 5 }, { id: NOTIFICATION_BASE }] };
    if (method === 'checkPermissions') return { display: 'granted' };
    return {};
  };
  const first = f.app.refreshNotifications(false);
  f.app.engine.configure({ ...config, enabled: false });
  const second = f.app.refreshNotifications(false);
  await Promise.all([first, second]);
  assert.equal(operations.some(x => x[0] === 'schedule'), false);
  assert.deepEqual(operations.find(x => x[0] === 'cancel')[1], { notifications: [{ id: NOTIFICATION_BASE }] });
});

test('settings save and reload without opening the offline menu or having a controller', async () => {
  const data = new Map(), storage = { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v) };
  const app = new Integration({ root: {}, storage, document: { visibilityState: 'visible', querySelectorAll: () => [] } });
  await app.configure({ enabled: true, inTime: '07:40', outTime: '21:40', days: [1, 4, 7] });
  assert.equal(app.engine, null);
  assert.deepEqual(app.settings().days, [1, 4, 7]);
  assert.equal(app.settings().enabled, false); // No recording without an account.
  const reload = new Integration({ root: {}, storage, document: {} });
  assert.equal(reload.settings().inTime, '07:40');
  assert.equal(reload.settings().zone, 'Asia/Makassar');
});
test('root services bind the active online account without an offline-menu visit', async () => {
  for (const online of [true, false]) {
    const f = fixture(); f.app.controller = null; f.app.automaticController = null;
    const network = { isOnline: online, isOffline: !online };
    f.machine.networkService = network;
    const calls = [], navigated = [];
    f.machine.recordAttendance = async flags => { calls.push(flags); return { id: 'new-record', datetime: 'original-time', geolocation: { latitude: 1, longitude: 2 } }; };
    const nav = { deviceService: { isNative: true }, responsiveService: { getIsMobile: () => true }, push: async (...args) => { navigated.push(args); } };
    f.app.attachMachine(f.machine); f.app.attachNavigation(nav);
    await f.app.poll();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { isAttendanceBarcode: false, isOnline: false, isOnCall: false });
    assert.deepEqual(network, { isOnline: online, isOffline: !online });
    assert.equal(navigated[0][0], '/hr/attendance/attendance-record-time/time-attendance-preview');
    assert.equal(navigated[0][1].datetime, 'original-time');
    assert.equal(navigated[0][1].attOn, 'offline');
    f.activatePreview(); await f.app.poll(); assert.equal(f.saves(), 1);
  }
});
test('offline storage never waits for online button lookup or selects yesterday/tomorrow', async () => {
  for (const slot of ['in','out']) {
    const f = fixture();
    if (slot === 'out') f.setNow(Date.parse('2026-11-06T13:55:10Z'));
    await f.app.poll(); f.activatePreview();
    f.preview.loadingGetBtn = true; f.preview.btnSave = false;
    f.preview.showSaveAttendance = false; f.preview.btnAttendance = { outyesterday: true, intomorrow: true };
    let selected;
    f.preview.saveAttendance = async value => { selected = value; return f.service.saveAttendanceToStorage(f.preview.params); };
    await f.app.poll(); assert.equal(selected, 0); assert.equal(f.saves(), 1);
  }
});

test('a stalled notification plugin does not block saving settings', async () => {
  const f = fixture(); f.app.refreshNotifications = () => new Promise(() => {});
  await f.app.configure({ ...config, inTime: '07:30' });
  assert.equal(f.app.settings().inTime, '07:30');
  assert.equal(f.app.notice, 'Jadwal tersimpan.');
});
test('legacy profiles migrate to WITA while preserving times, workdays, and reservations', () => {
  const e = new Core.Engine({ load: () => ({ config: { ...config, zone: 'Asia/Jakarta' }, ledger: { '2026-11-06:in': { status: 'stored-offline' } } }), save: () => {}, run: () => {} });
  assert.equal(e.config.zone, 'Asia/Makassar');
  assert.equal(e.config.inTime, '08:00');
  assert.equal(e.ledger['2026-11-06:in'].status, 'stored-offline');
});

test('diagnostics expose gate state without credentials', async () => {
  const f = fixture({ trial: false }); f.app.features.sendGate = true;
  const sync = { syncAttendanceOffline: async () => {} };
  assert.equal(f.app.syncGate([{ id: 'q1' }, { id: 'q2' }], sync), false);
  const d = f.app.diagnostics();
  assert.equal(d.zone, Core.ZONE);
  assert.deepEqual(d.pendingIds, ['q1', 'q2']);
  assert.equal(d.syncServiceAvailable, true);
  assert.equal(d.accountKnown, true);
  const text = JSON.stringify(d);
  assert.ok(!text.includes('company-test') && !text.includes('user-test') && !text.includes('dika.offline'));
  assert.equal(f.app.confirmSend(), true);
  assert.deepEqual(f.app.diagnostics().pendingIds, []);
  assert.equal(f.app.syncGate([{ id: 'q1' }, { id: 'q2' }], sync), true); // approved batch passes
  assert.equal(f.app.diagnostics().pendingIds.length, 0);
});

test('signature bypass answers only the AntiTampering verify call', async () => {
  const calls = [];
  const fakeRoot = { Capacitor: { nativePromise: async (p, m) => { calls.push(p + '.' + m); return { status: 'ERROR' }; } } };
  installSignatureBypass(fakeRoot);
  assert.deepEqual(await fakeRoot.Capacitor.nativePromise('AntiTampering', 'verify', {}), { status: 'OK' });
  // Every other plugin method — including every other detection — reaches
  // the real bridge unchanged.
  const untouched = await fakeRoot.Capacitor.nativePromise('SecurityCheck', 'isTampered', {});
  assert.equal(untouched.status, 'ERROR');
  assert.deepEqual(calls, ['SecurityCheck.isTampered']);
  // Idempotent: a second install never double-wraps.
  installSignatureBypass(fakeRoot);
  assert.deepEqual(await fakeRoot.Capacitor.nativePromise('AntiTampering', 'verify', {}), { status: 'OK' });
  assert.deepEqual(calls, ['SecurityCheck.isTampered']);
  const f = fixture();
  assert.equal(f.app.diagnostics().signatureBypassInstalled, false); // fixture has no Capacitor
});

test('native navigation dismissal cannot hold the scheduler busy', { timeout: 1000 }, async () => {
  const f = fixture();
  f.machine.recordAttendance = async () => ({ id: 'new-record', geolocation: { latitude: -5.1, longitude: 119.4 } });
  const nav = { deviceService: { isNative: true }, responsiveService: { getIsMobile: () => true }, push: () => new Promise(() => {}) };
  f.app.attachMachine(f.machine); f.app.attachNavigation(nav);
  await f.app.poll();
  assert.equal(f.app.engine.busy, false);
  f.activatePreview(); await f.app.poll();
  assert.equal(f.app.engine.ledger['2026-11-06:in:08:00'].status, 'stored-offline');
});

test('catch-up stops at 15 minutes, never before the slot or on another local day', () => {
  const scheduled = NOW - 10000;
  assert.equal(Core.due(config, scheduled - 1, {}).length, 0);
  assert.equal(Core.due(config, scheduled + Core.CATCH_UP_MS, {}).length, 1);
  assert.equal(Core.due(config, scheduled + Core.CATCH_UP_MS + 1, {}).length, 0);
  assert.equal(Core.due(config, Date.parse('2026-11-06T16:00:00Z'), {}).length, 0);
  assert.equal(Core.DEFAULT.inTime, '07:30'); assert.equal(Core.DEFAULT.outTime, '19:30');
});

test('late permission and overlays wait without consuming the slot', async () => {
  const f = fixture({ allowed: false }); await f.app.poll();
  assert.equal(f.app.engine.ledger['2026-11-06:in:08:00'], undefined);
  f.machine.auth.companySetting.offlineMode = true;
  f.app.visible = selector => selector === 'ion-alert,ion-loading';
  await f.app.poll(); assert.equal(f.calls(), 0);
  f.app.visible = () => false; f.setNow(NOW + 60000);
  await f.app.poll(); assert.equal(f.calls(), 1);
  f.activatePreview(); await f.app.poll(); assert.equal(f.saves(), 1);
});

test('a recorder that becomes native/mobile after attachment is connected on resume', async () => {
  const f = fixture(); f.app.controller = null; let mobile = false, calls = 0;
  f.machine.recordAttendance = async () => { calls++; return { id:'new-record', geolocation:{latitude:-5,longitude:119} }; };
  const nav = { deviceService:{isNative:true},responsiveService:{getIsMobile:()=>mobile},push:async()=>{} };
  f.app.attachMachine(f.machine); f.app.attachNavigation(nav);
  await f.app.poll(); assert.equal(calls, 0);
  mobile = true; f.setNow(NOW + 60000); await f.app.poll(); assert.equal(calls, 1);
  assert.equal(f.app.requiresLocation(f.machine), true);
  assert.equal(f.app.requiresLocation({}), false);
});

test('location-only saving does not wait for unused photo processors', async () => {
  const f = fixture(); await f.app.poll(); f.activatePreview();
  f.preview.attendancePreviewService = { checkingFaceDetection:true,isUploading:true,resultFaceDetection:{reject:true} };
  f.preview.isSetFirstBP = true; f.preview.showBtnRetake = true;
  await f.app.poll(); assert.equal(f.saves(), 1);
});

test('camera-required accounts wait without recording or changing their settings', async () => {
  const f = fixture(); const settings={takePhoto:true}; f.machine.getAttendanceSetting=()=>settings;
  await f.app.poll(); assert.equal(f.calls(), 0); assert.equal(settings.takePhoto,true);
  settings.takePhoto=false; await f.app.poll(); assert.equal(f.calls(),1);
});

test('settings that are still loading do not disable the engine or consume the slot', async () => {
  const f=fixture();f.machine.getAttendanceSetting=()=>{throw Error('loading');};
  await f.app.poll();assert.ok(f.app.engine);assert.equal(f.calls(),0);
  assert.equal(f.app.engine.ledger['2026-11-06:in:08:00'],undefined);
  f.machine.getAttendanceSetting=()=>({takePhoto:false});await f.app.poll();assert.equal(f.calls(),1);
});

test('missing, invalid and cached coordinates are never saved as automatic attendance', async () => {
  for (const geolocation of [null,{latitude:0,longitude:0},{latitude:NaN,longitude:119},{latitude:91,longitude:119},{latitude:-5,longitude:119,cacheLocation:true}]) {
    const f=fixture(); f.controller.recordAttendance=()=>{const ticket=f.app.ticketFor(f.controller); f.app.captured(ticket,{id:'new-record',attOn:'offline',geolocation});};
    await f.app.poll(); f.activatePreview(); await f.app.poll();
    assert.equal(f.saves(),0); assert.equal(f.app.engine.ledger['2026-11-06:in:08:00'].status,'needs-user');
  }
});

test('queue UI data comes from original storage, independently of the optional send gate', async () => {
  const f=fixture(); let records=[{id:'manual-record'}];
  f.app.attachSync({baseStorage:{getGreatdayStorage:async key=>{assert.equal(key,9);return records;}}});
  assert.equal(f.app.diagnostics().queueIds,null);
  await f.app.refreshQueue(true); assert.deepEqual(f.app.diagnostics().queueIds,['manual-record']);
  assert.deepEqual(f.app.diagnostics().pendingIds,[]);
  records=[];await f.app.refreshQueue(true);assert.deepEqual(f.app.diagnostics().queueIds,[]);
});

test('delayed queue reads cannot leak records across an account change', async () => {
  const f=fixture();let resolve;
  f.app.attachSync({baseStorage:{getGreatdayStorage:()=>new Promise(r=>{resolve=r;})}});
  const reading=f.app.refreshQueue(true);
  f.machine.auth.gdAuth.userId='another-user';f.app.ensureAccount();resolve([{id:'old-account-record'}]);await reading;
  assert.equal(f.app.diagnostics().queueIds,null);assert.equal(f.app.pending,null);
});

test('an interrupted record with a confirmed ID is reconciled without recording again', async () => {
  const f=fixture();await f.app.poll();
  const entry=f.app.engine.ledger['2026-11-06:in:08:00'];entry.status='interrupted';f.app.active=null;
  f.app.attachSync({baseStorage:{getGreatdayStorage:async()=>[{id:entry.recordId}]}});
  await f.app.refreshQueue(true);await f.app.poll();
  assert.equal(f.calls(),1);assert.equal(entry.status,'stored-offline');
});

test('without the optional send gate, GreatDay retains its normal sync behavior', () => {
  const f=fixture({trial:false});assert.equal(f.app.features.sendGate,false);
  assert.equal(f.app.syncGate([{id:'manual'}],{syncAttendanceOffline:async()=>{}}),true);
  assert.equal(f.app.pending,null);
});

test('reminder-only selection never records and uses concise notification text', async () => {
  const f=fixture();f.app.features.scheduler=false;
  f.app.refreshNotifications=Integration.prototype.refreshNotifications;
  const sent=[];f.app.native=async(method,options)=>{
    if(method==='getPending')return{notifications:[]};
    if(method==='checkPermissions')return{display:'granted'};
    if(method==='schedule')sent.push(...options.notifications);return{};
  };
  await f.app.poll();assert.equal(f.calls(),0);
  await f.app.refreshNotifications(false);assert.ok(sent.length>0);
  assert.equal(sent[0].title,'Absen pulang');assert.equal(sent[0].body,'Buka GreatDay untuk mencatat kehadiran.');
  f.app.features.reminders=false;sent.length=0;await f.app.refreshNotifications(false);assert.equal(sent.length,0);
});

test('v0.7.0 04:30 reservation permits a new 04:35 schedule and preserves the old attempt', async () => {
  const now = Date.parse('2026-11-08T04:35:10+08:00');
  const oldKey = '2026-11-08:in';
  const old = { key: oldKey, date: '2026-11-08', slot: 'in', scheduled: '04:30', recordId: 'first', status: 'stored-offline' };
  let saved, calls = 0;
  const settings = { ...config, days: [7], inTime: '04:35' };
  const e = new Core.Engine({ trial: true, load: () => ({ config: settings, ledger: { [oldKey]: old } }),
    save: d => { saved = JSON.parse(JSON.stringify(d)); }, now: () => now, run: () => { calls++; } });
  await e.tick(); await e.tick();
  assert.equal(calls, 1);
  assert.equal(e.ledger[oldKey].recordId, 'first');
  assert.equal(e.ledger['2026-11-08:in:04:35'].status, 'running');
  e.configure({ ...settings, inTime: '04:30' }); await e.tick(); assert.equal(calls, 1);
  e.configure(settings);
  const restarted = new Core.Engine({ trial: true, load: () => saved, save: () => {}, now: () => now, run: () => { calls++; } });
  await restarted.tick(); assert.equal(calls, 1);
  assert.equal(restarted.ledger['2026-11-08:in:04:35'].status, 'interrupted');
});

test('incomplete legacy reservations stay blocked when their original time is unknown', () => {
  const legacy = { '2026-11-06:in': { status: 'stored-offline' } };
  assert.equal(Core.due(config, NOW, legacy).length, 0);
  assert.equal(Core.due({ ...config, inTime: '08:01' }, NOW + 60000, legacy).length, 0);
});

test('saving, toggling or changing workdays cannot repeat the same scheduled time', async () => {
  const f = fixture(); await f.app.poll(); f.activatePreview(); await f.app.poll();
  for (const changed of [config, { ...config, enabled: false }, { ...config, days: [5, 7] }, config]) {
    await f.app.configure(changed); await f.app.poll();
  }
  assert.equal(f.calls(), 1); assert.equal(f.saves(), 1);
});

test('schedule cannot be changed while a native recording is in progress', async () => {
  const f = fixture(); await f.app.poll();
  await assert.rejects(f.app.configure({ ...config, inTime: '08:05' }), /Tunggu proses/);
  assert.equal(f.app.settings().inTime, '08:00');
  f.activatePreview(); await f.app.poll(); assert.equal(f.saves(), 1);
});

test('current schedule status separates earlier attempts, local queue and unknown server receipt', async () => {
  const f = fixture(); await f.app.poll(); f.activatePreview(); await f.app.poll();
  assert.equal(f.app.scheduleState()[0].state, 'queued');
  f.app.attachSync({ baseStorage: { getGreatdayStorage: async () => [] } });
  await f.app.refreshQueue(true);
  assert.equal(f.app.scheduleState()[0].state, 'queue-missing');
  assert.equal(f.app.engine.history.at(-1).status, 'stored-offline'); // Preserve the historical fact.
  await f.app.configure({ ...config, inTime: '08:05' });
  assert.equal(f.app.scheduleState()[0].state, 'scheduled');
  assert.equal(f.app.scheduleState()[0].recordId, null);
  f.setNow(NOW + 5 * 60000); assert.equal(f.app.scheduleState()[0].state, 'waiting');
  f.setNow(NOW + 21 * 60000); assert.equal(f.app.scheduleState()[0].state, 'missed');
  f.app.queueIds = null; await f.app.configure(config);
  assert.equal(f.app.scheduleState()[0].state, 'saved-unchecked');
});

test('history rolls over at 50 events on load and while recording', () => {
  let saved;
  const history = Array.from({length: 95}, (_, i) => ({at:i,key:'old',status:'stored-offline',message:String(i)}));
  const e = new Core.Engine({load:()=>({config,history}),save:data=>{saved=structuredClone(data);},now:()=>NOW,run:()=>{}});
  assert.equal(e.history.length,50); assert.equal(e.history[0].at,45);
  for(let i=0;i<8;i++)e.event('new','running',String(i));
  assert.equal(saved.history.length,50); assert.equal(saved.history[0].at,53);
  assert.equal(saved.history.at(-1).message,'7');
});

test('clearing history preserves anti-duplicate reservations and native queue data', async () => {
  const f=fixture(); await f.app.poll(); f.activatePreview(); await f.app.poll();
  const ledger=structuredClone(f.app.engine.ledger), queue=[...f.app.queueIds];
  f.app.clearHistory();
  assert.deepEqual(f.app.engine.history,[]); assert.deepEqual(f.app.engine.ledger,ledger);
  assert.deepEqual(f.app.queueIds,queue); await f.app.poll();
  assert.equal(f.calls(),1); assert.equal(f.saves(),1);
});

test('trial reset removes only selected current WITA-day reservations and permits an explicit repeat', async () => {
  const f=fixture(); await f.app.poll(); f.activatePreview(); await f.app.poll();
  f.app.engine.ledger['2026-11-05:in:08:00']={key:'2026-11-05:in:08:00',status:'stored-offline'};
  f.app.engine.ledger['2026-11-06:out:21:55']={key:'2026-11-06:out:21:55',status:'interrupted'};
  const queue=[...f.app.queueIds]; assert.equal(f.app.resetTrial('in'),1);
  assert.equal(f.app.engine.ledger['2026-11-06:in:08:00'],undefined);
  assert.ok(f.app.engine.ledger['2026-11-05:in:08:00']); assert.ok(f.app.engine.ledger['2026-11-06:out:21:55']);
  assert.deepEqual(f.app.queueIds,queue); assert.equal(f.saves(),1);
  assert.equal(f.app.engine.history.at(-1).status,'reset-test');
  f.app.visible=()=>false; await f.app.poll(); assert.equal(f.calls(),2);
});

test('reset and clearing are blocked during active work, and reset is unavailable in final mode', async () => {
  const f=fixture(); await f.app.poll();
  assert.throws(()=>f.app.resetTrial('in'),/Tunggu proses/);
  assert.throws(()=>f.app.clearHistory(),/Tunggu proses/);
  f.activatePreview(); await f.app.poll(); f.app.engine.busy=true;
  assert.throws(()=>f.app.resetTrial('in'),/Tunggu proses/); f.app.engine.busy=false;
  assert.throws(()=>f.app.resetTrial('invalid'),/Pilih masuk/);
  const final=fixture({trial:false}); assert.throws(()=>final.app.resetTrial('in'),/hanya tersedia/);
  assert.throws(()=>final.app.engine.resetTrial('in'),/hanya tersedia/);
});

test('reset and clear restore in-memory state if persistence fails', async () => {
  const f=fixture(); await f.app.poll(); f.activatePreview(); await f.app.poll();
  const ledger=structuredClone(f.app.engine.ledger), history=structuredClone(f.app.engine.history);
  f.app.engine.save=()=>{throw Error('full');};
  assert.throws(()=>f.app.resetTrial('in'),/full/); assert.deepEqual(f.app.engine.ledger,ledger); assert.deepEqual(f.app.engine.history,history);
  assert.throws(()=>f.app.clearHistory(),/full/); assert.deepEqual(f.app.engine.history,history);
});

test('trial build always holds server sends regardless of feature selection, stale approvals or confirmation', () => {
  for(const sendGate of [false,true]) {
    const f=fixture(); let calls=0; f.app.features.sendGate=sendGate; f.app.approvals={'existing':true};
    const service={syncAttendanceOffline:()=>{calls++;}};
    assert.equal(f.app.syncGate([{id:'existing'}],service),false);
    assert.deepEqual(f.app.approvals,{}); assert.equal(f.app.confirmSend(),false); assert.equal(calls,0);
    assert.equal(f.app.syncGate([],service),false); assert.equal(f.app.diagnostics().serverSendHeld,true);
    assert.equal(f.app.diagnostics().trialBuild,true);
  }
  const unbound=new Integration({root:{},document:{},storage:{getItem:()=>null,setItem:()=>{}},features:{trial:true}});
  assert.equal(unbound.syncGate([{id:'manual'}],{}),false);
});

test('final mode reserves one slot per date even after editing the time or loading time-keyed trials', async () => {
  const f=fixture({trial:false}); await f.app.poll(); f.activatePreview(); await f.app.poll();
  assert.ok(f.app.engine.ledger['2026-11-06:in']);
  await f.app.configure({...config,inTime:'08:05'}); f.setNow(NOW+5*60000); await f.app.poll();
  assert.equal(f.calls(),1); assert.equal(f.app.scheduleState()[0].state,'already-attempted');
  assert.equal(f.app.scheduleState()[0].attemptScheduled,'08:00');
  for(const status of ['stored-offline','needs-user','interrupted','running']) {
    for(const key of ['2026-11-06:in','2026-11-06:in:08:00']) {
      let calls=0;
      const e=new Core.Engine({load:()=>({config:{...config,inTime:'08:05'},ledger:{[key]:{key,scheduled:'08:00',status}}}),save:()=>{},now:()=>NOW+5*60000,run:()=>{calls++;}});
      await e.tick(); assert.equal(calls,0,`${key} ${status}`); assert.equal(e.trial,false);
    }
  }
});
