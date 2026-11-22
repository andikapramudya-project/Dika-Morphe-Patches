const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../patches/src/main/resources/greatday8/core.js');
const { Integration } = require('../patches/src/main/resources/greatday8/runtime.js');
const { attach, PREFIX } = require('../patches/src/main/resources/greatday8/background.js');

const NOW = Date.parse('2026-11-08T04:35:10+08:00');
const config = { ...Core.DEFAULT, enabled: true, days: [7], inTime: '04:35', outTime: '19:30' };
function fixture(features = {}) {
  const data = new Map(), native = [], published = [], records = [];
  let callback, count = 0, saves = 0;
  const root = { Capacitor: {
    nativeCallback(plugin, method, options, fn) { assert.equal(plugin, 'BackgroundFetch'); callback = fn; return 'listener'; },
    async nativePromise(plugin, method, options) { native.push({ plugin, method, options }); return {}; }
  } };
  const app = new Integration({ root, now: () => NOW, document: { visibilityState: 'hidden', querySelectorAll: () => [] },
    storage: { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) },
    features: { trial: true, scheduler: true, reminders: false, backgroundFetchVerifiedUnused: true, ...features } });
  app.refreshNotifications = async () => {};
  const machine = { auth: { gdAuth: { id: 'test-company', userId: 'test-user' }, companySetting: { offlineMode: true } },
    getAttendanceSetting: () => ({ takePhoto: false }),
    async recordAttendance(flags) { count++; assert.deepEqual(flags, { isAttendanceBarcode: false, isOnline: false, isOnCall: false });
      return { id: 'background-' + count, datetime: new Date(NOW).toISOString(), geolocation: { latitude: -5.1, longitude: 119.4, cacheLocation: false } }; }
  };
  const controller = { attendanceMachineService: machine, recordAttendance() { throw Error('Preview route must never be opened'); } };
  app.attachOffline(controller); app.engine.configure(config);
  const service = { async saveAttendanceToStorage(params) { saves++; records.push(params); return records.slice(); },
    responseFailed$: { next: params => published.push(params.id) } };
  app.attachSync(service); app.visible = () => false;
  const runner = attach(app);
  // Parent integration permits a hidden recording only during an owned native wake.
  app.readiness = () => runner.ownsWake() ? '' : 'Menunggu aplikasi dibuka.';
  const task = () => [...runner.owned][0];
  const last = () => app.engine.history.at(-1);
  return { app, root, runner, native, machine, service, published, records, task, last,
    calls: () => count, saves: () => saves, callback: () => callback };
}

test('native location keeper uses only the trial alias and is removed when disabled', async () => {
  const f=fixture({backgroundKeeper:true}); f.app.doc.visibilityState='visible';
  f.root.Capacitor.PluginHeaders=[{name:'DikaBackgroundGeolocation',methods:[{name:'addWatcher'}]}];
  const callback=f.root.Capacitor.nativeCallback;
  f.root.Capacitor.nativeCallback=(plugin,method,options,fn)=>{
    if(plugin==='DikaBackgroundGeolocation') {
      assert.equal(method,'addWatcher');assert.equal(options.requestPermissions,false);assert.ok(options.backgroundMessage);
      // Keeper coordinates must never become an attendance record.
      fn({latitude:10,longitude:20},null); return 'keeper-1';
    }
    return callback(plugin,method,options,fn);
  };
  await f.runner.configureSchedule(); assert.equal(f.runner.keeperId,'keeper-1'); assert.equal(f.saves(),0);
  assert.equal(f.runner.diagnostics().locationService.requested,true);
  f.app.engine.configure({...config,enabled:false});await f.runner.configureSchedule();
  assert.equal(f.runner.keeperId,null);
  assert.ok(f.native.some(c=>c.plugin==='DikaBackgroundGeolocation'&&c.method==='removeWatcher'&&c.options.id==='keeper-1'));
  assert.ok(f.native.every(c=>c.plugin!=='BackgroundGeolocation'));
});

test('missing alias or hidden startup cannot silently enable a native location keeper', async () => {
  for(const visible of [true,false]) {
    const f=fixture({backgroundKeeper:true});f.app.doc.visibilityState=visible?'visible':'hidden';
    await f.runner.configureSchedule();assert.equal(f.runner.status,'unavailable');
    assert.equal(f.native.some(c=>c.method==='configure'||c.method==='scheduleTask'),false);assert.equal(f.calls(),0);
  }
});

test('a native keeper error removes its watcher and blocks a later background recording', async () => {
  const f=fixture({backgroundKeeper:true}); f.app.doc.visibilityState='visible'; let fail;
  f.root.Capacitor.PluginHeaders=[{name:'DikaBackgroundGeolocation',methods:[{name:'addWatcher'}]}];
  const callback=f.root.Capacitor.nativeCallback;
  f.root.Capacitor.nativeCallback=(plugin,method,options,fn)=>{
    if(plugin==='DikaBackgroundGeolocation'){fail=fn;return 'keeper-error';}
    return callback(plugin,method,options,fn);
  };
  await f.runner.configureSchedule(); const task=f.task(); fail(null,{message:'denied'});
  await Promise.resolve();await Promise.resolve();await f.runner.handleFetch({taskId:task});
  assert.equal(f.calls(),0);assert.equal(f.runner.keeperId,null);
  assert.ok(f.native.some(c=>c.method==='removeWatcher'&&c.options.id==='keeper-error'));
});

test('only a configured trial location service permits hidden polling and never finishes a native task', async () => {
  const f=fixture({backgroundKeeper:true}); f.app.doc.visibilityState='visible';
  f.root.Capacitor.PluginHeaders=[{name:'DikaBackgroundGeolocation',methods:[{name:'addWatcher'}]}];
  const callback=f.root.Capacitor.nativeCallback;
  f.root.Capacitor.nativeCallback=(plugin,method,options,fn)=>plugin==='DikaBackgroundGeolocation'?'keeper-poll':callback(plugin,method,options,fn);
  await f.runner.configureSchedule();assert.equal(await f.runner.pollHidden(),false);
  f.app.doc.visibilityState='hidden';
  assert.equal(await f.runner.pollHidden(),true);assert.equal(f.saves(),1);
  assert.equal(f.runner.lastWakeSource,'foreground-service-poll');assert.equal(f.runner.pollWake,false);
  assert.equal(f.runner.ownsWake(),false);assert.equal(f.app.backgroundWake,false);
  assert.equal(f.native.some(c=>c.method==='finish'),false);
  assert.equal(await f.runner.pollHidden(),false);assert.equal(f.saves(),1);
});

test('hidden timer and native delivery share one reservation without stealing timer ownership', async () => {
  const f=fixture({backgroundKeeper:true}); f.app.doc.visibilityState='visible';
  f.root.Capacitor.PluginHeaders=[{name:'DikaBackgroundGeolocation',methods:[{name:'addWatcher'}]}];
  const callback=f.root.Capacitor.nativeCallback;
  f.root.Capacitor.nativeCallback=(plugin,method,options,fn)=>plugin==='DikaBackgroundGeolocation'?'keeper-race':callback(plugin,method,options,fn);
  await f.runner.configureSchedule(); f.app.doc.visibilityState='hidden';
  const original=f.machine.recordAttendance;let resume;
  f.machine.recordAttendance=async flags=>{await new Promise(r=>{resume=r;});return original(flags);};
  const polling=f.runner.pollHidden();assert.equal(f.runner.ownsWake(),true);
  await f.runner.handleFetch({taskId:f.task()});assert.equal(f.runner.ownsWake(),true);
  resume();await polling;assert.equal(f.saves(),1);assert.equal(f.calls(),1);assert.equal(f.runner.ownsWake(),false);
});

test('owned native wake records into original storage while WebView is hidden, without navigation', async () => {
  const f = fixture(); await f.runner.configureSchedule();
  assert.equal(f.runner.diagnostics().supportsProcessRestart, false);
  assert.equal(f.runner.diagnostics().status, 'scheduled');
  assert.equal(f.native.filter(c => c.method === 'configure').length, 1);
  const schedules = f.native.filter(c => c.method === 'scheduleTask');
  assert.ok(schedules.length > 0 && schedules.length <= 28);
  assert.ok(schedules.every(c => c.options.options.taskId.startsWith(PREFIX) && c.options.options.requiredNetworkType === 0 && !c.options.options.enableHeadless));
  const taskId = f.task(); await f.runner.handleFetch({ taskId });
  assert.equal(f.calls(), 1); assert.equal(f.saves(), 1);
  assert.equal(f.last().status, 'stored-offline');
  assert.equal(f.records[0].attOn, 'offline');
  assert.equal(f.records[0].datetime, new Date(NOW).toISOString());
  assert.deepEqual(f.published, ['background-1']);
  assert.equal(f.app.active, null); assert.equal(f.app.backgroundWake, false);
  assert.ok(f.native.some(c => c.method === 'finish' && c.options.taskId === taskId));
  await f.runner.handleFetch({ taskId }); assert.equal(f.saves(), 1);
});

test('ordinary polling cannot gain hidden-recording authority', async () => {
  const f = fixture(); await f.app.engine.tick();
  assert.equal(f.calls(), 0); assert.equal(Object.keys(f.app.engine.ledger).length, 0);
});

test('an unresolved location request releases the engine after its deadline and a late result cannot save', async () => {
  const f=fixture();await f.runner.configureSchedule();let resolve;
  f.machine.recordAttendance=()=>new Promise(r=>{resolve=r;});
  f.root.setTimeout=fn=>setTimeout(fn,1);f.root.clearTimeout=clearTimeout;
  await f.runner.handleFetch({taskId:f.task()});
  assert.equal(f.app.engine.busy,false);assert.equal(f.app.active,null);assert.equal(f.last().status,'needs-user');
  resolve({id:'late',datetime:new Date(NOW).toISOString(),geolocation:{latitude:-5,longitude:119}});
  await Promise.resolve();assert.equal(f.saves(),0);
  await f.app.engine.tick();assert.equal(f.saves(),0);
});

test('an uncertain native save remains reserved when its promise exceeds the deadline', async () => {
  const f=fixture();await f.runner.configureSchedule();let resolve;
  f.service.saveAttendanceToStorage=()=>new Promise(r=>{resolve=r;});
  f.root.setTimeout=fn=>setTimeout(fn,1);f.root.clearTimeout=clearTimeout;
  await f.runner.handleFetch({taskId:f.task()});
  assert.equal(f.app.engine.busy,false);assert.equal(f.last().status,'needs-user');assert.equal(f.app.active,null);
  resolve([{id:'background-1'}]);await Promise.resolve();await f.app.engine.tick();assert.equal(f.calls(),1);
});

test('final build, absent fingerprint verification, and another native owner fail closed', async () => {
  for (const features of [{ trial: false }, { scheduler: false }, { backgroundFetchVerifiedUnused: false }]) {
    const f = fixture(features); await f.runner.configureSchedule();
    assert.equal(f.native.some(c => c.method === 'configure' || c.method === 'scheduleTask'), false);
    assert.equal(f.calls(), 0);
  }
  const f = fixture(); f.root.DikaBackgroundFetchOwner = 'host-plugin';
  await f.runner.configureSchedule(); assert.equal(f.runner.status, 'unavailable');
  assert.equal(f.native.some(c => c.method === 'configure'), false);
});

test('schedule reconfiguration stops only owned tasks and does not duplicate native listeners', async () => {
  const f = fixture(); await f.runner.configureSchedule();
  const count = f.native.length; await f.runner.configureSchedule(); assert.equal(f.native.length, count);
  const first = [...f.runner.owned]; f.app.engine.configure({ ...config, inTime: '04:40' });
  await f.runner.configureSchedule();
  assert.ok(first.every(id => f.native.some(c => c.method === 'stop' && c.options.taskId === id)));
  assert.ok(f.native.filter(c => c.method === 'stop').every(c => c.options.taskId === 'capacitor-background-fetch' || c.options.taskId.startsWith(PREFIX)));
  assert.equal(f.native.filter(c => c.method === 'configure').length, 1);
});

test('unrelated native events are neither consumed nor finished', async () => {
  const f = fixture(); await f.runner.configureSchedule();
  await f.runner.handleFetch({ taskId: 'host-task', timeout: false });
  await f.runner.handleFetch({ taskId: PREFIX + 'not-owned', timeout: true });
  assert.equal(f.native.filter(c => c.method === 'finish').length, 0); assert.equal(f.calls(), 0);
});

test('native timeout and recording exceptions always finish the owned task', async () => {
  for (const timeout of [false, true]) {
    const f = fixture(); f.machine.recordAttendance = async () => { throw Error('native failure'); };
    await f.runner.configureSchedule(); const taskId = f.task();
    await f.runner.handleFetch({ taskId, timeout });
    assert.ok(f.native.some(c => c.method === 'finish' && c.options.taskId === taskId));
    assert.equal(f.saves(), 0); assert.equal(f.app.backgroundWake || false, false);
    if (!timeout) assert.equal(f.last().status, 'needs-user');
  }
});

test('background storage preserves photo, face, location and timestamp guards', async () => {
  for (const mutate of [
    f => { f.machine.getAttendanceSetting = () => ({ takePhoto: true }); },
    f => { f.machine.auth.companySetting.attendanceFaceBlock = true; },
    f => { f.machine.auth.companySetting.attendanceFaceLivenessBlocking = true; },
    f => { f.machine.recordAttendance = async () => ({ id:'bad',datetime:new Date(NOW).toISOString(),geolocation:{latitude:-5,longitude:119,cacheLocation:true} }); },
    f => { f.machine.recordAttendance = async () => ({ id:'old',datetime:new Date(NOW - 6*60000).toISOString(),geolocation:{latitude:-5,longitude:119} }); },
    f => { f.machine.recordAttendance = async () => ({ id:'invalid',datetime:'invalid',geolocation:{latitude:-5,longitude:119} }); }
  ]) {
    const f = fixture(); mutate(f); await f.runner.configureSchedule(); const taskId=f.task();
    await f.runner.handleFetch({ taskId }); assert.equal(f.saves(), 0);
    assert.equal(f.last().status, 'needs-user'); assert.equal(f.app.active, null);
    assert.ok(f.native.some(c => c.method === 'finish' && c.options.taskId === taskId));
  }
});

test('failed native storage is not reported as success or retried', async () => {
  const f = fixture(); f.service.saveAttendanceToStorage = async () => { throw Error('storage failed'); };
  await f.runner.configureSchedule(); await f.runner.handleFetch({ taskId:f.task() });
  assert.equal(f.last().status, 'needs-user'); assert.equal(f.app.active, null);
  await f.runner.configureSchedule(true); await f.runner.handleFetch({ taskId:f.task() }); assert.equal(f.calls(), 1);
});

test('account changes while location is pending prevent cross-account persistence', async () => {
  const f = fixture(); let release;
  f.machine.recordAttendance = () => new Promise(resolve => { release=resolve; });
  await f.runner.configureSchedule(); const work=f.runner.handleFetch({taskId:f.task()});
  await Promise.resolve(); f.machine.auth.gdAuth.userId='different-user'; f.app.ensureAccount();
  release({id:'old-account',datetime:new Date(NOW).toISOString(),geolocation:{latitude:-5,longitude:119}});
  await work; assert.equal(f.saves(),0); assert.equal(f.app.active,null);
});

test('duplicate delivery cannot steal an in-flight native wake or cause duplicate saves', async () => {
  const f=fixture(); let release;
  f.machine.recordAttendance=()=>new Promise(resolve=>{release=resolve;});
  await f.runner.configureSchedule(); const taskId=f.task(), work=f.runner.handleFetch({taskId});
  await Promise.resolve(); await f.runner.handleFetch({taskId});
  assert.equal(f.runner.ownsWake(),true);
  assert.equal(f.native.filter(c=>c.method==='finish').length,0);
  release({id:'pending',datetime:new Date(NOW).toISOString(),geolocation:{latitude:-5,longitude:119}});
  await work; assert.equal(f.saves(),1); assert.equal(f.last().status,'stored-offline');
  assert.equal(f.native.filter(c=>c.method==='finish').length,1);
});

test('an earlier preview storage wrapper still confirms and publishes background persistence once', async () => {
  const f=fixture(); f.app.attachPreview({attendanceSyncService:f.service});
  await f.runner.configureSchedule(); await f.runner.handleFetch({taskId:f.task()});
  assert.equal(f.saves(),1); assert.equal(f.last().status,'stored-offline');
  assert.deepEqual(f.published,['background-1']);
});

test('native timeout while location is pending prevents delayed saving and releases its task once', async () => {
  const f=fixture(); let release;
  f.machine.recordAttendance=()=>new Promise(resolve=>{release=resolve;});
  await f.runner.configureSchedule(); const taskId=f.task(),work=f.runner.handleFetch({taskId});
  await Promise.resolve(); await f.runner.handleFetch({taskId,timeout:true});
  release({id:'late',datetime:new Date(NOW).toISOString(),geolocation:{latitude:-5,longitude:119}});
  await work; assert.equal(f.saves(),0); assert.equal(f.last().status,'needs-user');
  assert.equal(f.runner.status,'timed-out');
  assert.equal(f.native.filter(c=>c.method==='finish').length,1);
});

test('actual device-time fallback requires an owned offline task for the same active account and machine', async () => {
 const f=fixture();await f.runner.configureSchedule();
 f.machine.networkService={isOffline:true};
 assert.equal(f.runner.useOfflineDeviceTime(f.machine),false);
 f.runner.currentTask=f.task();f.runner.waking=true;
 f.app.active={controller:f.app.controller,identity:f.app.identity};
 assert.equal(f.runner.useOfflineDeviceTime(f.machine),true);
 assert.equal(f.runner.useOfflineDeviceTime({...f.machine}),false);
 f.machine.networkService.isOffline=false;assert.equal(f.runner.useOfflineDeviceTime(f.machine),false);
 f.machine.networkService.isOffline=true;
 f.app.active.identity='another-account';assert.equal(f.runner.useOfflineDeviceTime(f.machine),false);
 f.app.active.identity=f.app.identity;f.app.features.trial=false;
 assert.equal(f.runner.useOfflineDeviceTime(f.machine),false);
});
