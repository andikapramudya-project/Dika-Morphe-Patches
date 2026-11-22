const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Integration } = require('../patches/src/main/resources/greatday8/runtime.js');
const { attach, DEFAULT } = require('../patches/src/main/resources/greatday8/native.js');
const Background = require('../patches/src/main/resources/greatday8/background.js');

function fixture(features = {}) {
  const handlers = {}, storage = new Map();
  const root = { location: { origin: 'https://localhost' }, addEventListener(name, fn) { handlers[name] = fn; } };
  const app = new Integration({ root, document: { visibilityState: 'visible', querySelectorAll: () => [] },
    storage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    features: { trial: true, nativeTrial: true, scheduler: true, reminders: true, ...features } });
  const controller = attach(app);
  return { app, controller, root, handlers, storage };
}
function state(config = {}) {
  return { mode: 'native-dummy-trial', config: { ...DEFAULT, ...config }, today: {},
    nextIn: config.enabled ? Date.parse('2026-11-09T07:00:00+08:00') : 0,
    nextOut: config.enabled ? Date.parse('2026-11-09T19:00:00+08:00') : 0,
    history: [], permissions: { exactAlarm: true, notifications: true }, dummyCount: 0,
    greatDayHook: 'NOT_IMPLEMENTED', serverSendHeld: true };
}
function channel(controller, responder = () => state()) {
  const requests = [];
  const port = { close() {}, start() {}, postMessage(text) {
    const request = JSON.parse(text); requests.push(request);
    if (request.method === 'pong') return;
    Promise.resolve().then(() => responder(request)).then(result => {
      if (result === undefined) return;
      port.onmessage({ data: JSON.stringify(result instanceof Error ? { id: request.id, error: result.message } : { id: request.id, result }) });
    });
  } };
  controller.connect(port);
  return { port, requests };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('native defaults are disabled at 07:00/19:00 and do not replay old enabled preferences', () => {
  const f = fixture();
  f.app.draft = { ...DEFAULT, enabled: true, inTime: '07:30' };
  assert.equal(f.app.settings().enabled, false); assert.equal(f.app.settings().inTime, '07:00');
  assert.equal(f.app.settings().outTime, '19:00');
  assert.equal(f.app.diagnostics().native.greatDayHook, 'NOT_IMPLEMENTED');
  assert.equal(Background.attach(f.app), null);
});

test('native mode cannot tick the old engine or call the original real recorder', async () => {
  const f = fixture(); let ticks = 0;
  f.app.account = () => null; f.app.engine = { tick() { ticks++; }, ledger: {}, history: [] };
  await f.app.poll(); assert.equal(ticks, 0);
  await assert.rejects(f.app.start({ slot: 'in' }), /dummy/);
  assert.equal(f.app.syncGate([{ id: 'held' }], {}), false);
  assert.equal(f.app.confirmSend(), false);
});

test('the message listener rejects remote origins and frame messages', () => {
  const f = fixture(); let connections = 0; f.controller.connect = () => connections++;
  const event = { data: 'dika-native-attendance-v1', ports: [{}], origin: '', source: null };
  f.root.location.origin = 'https://example.com'; f.handlers.message(event);
  f.root.location.origin = 'https://localhost'; f.handlers.message({ ...event, origin: 'https://evil.test' });
  f.handlers.message({ ...event, source: {} }); assert.equal(connections, 0);
  f.handlers.message(event); assert.equal(connections, 1);
});

test('native handshake adopts Android state, while unknown startup identity does not disable it', async () => {
  const f = fixture(); f.app.machine = { auth: {} }; // Host constructor exists before auth restoration.
  const c = channel(f.controller, () => state({ enabled: true }));
  await flush(); assert.equal(f.controller.ready, true); assert.equal(f.app.settings().enabled, true);
  assert.equal(c.requests[0].method, 'status');
  f.controller.disconnect();
});

test('native configuration includes account and action mode and reports a dummy result', async () => {
  const f = fixture(); f.app.account = () => 'synthetic-account';
  const c = channel(f.controller, request => state(request.config || {})); await flush();
  await f.app.configure({ ...DEFAULT, enabled: true });
  const sent = c.requests.find(r => r.method === 'configure');
  assert.equal(sent.identity, 'synthetic-account'); assert.equal(sent.config.recordLocation, true);
  assert.equal(f.app.settings().enabled, true); assert.match(f.app.notice, /dummy/);
  assert.equal(f.app.diagnostics().native.greatDayHook, 'NOT_IMPLEMENTED');
  f.controller.disconnect();
});

test('permission or storage rejection cannot claim a native schedule was enabled', async () => {
  const f = fixture(); f.app.account = () => 'account';
  channel(f.controller, request => request.method === 'configure' ? Error('Izin alarm diperlukan') : state()); await flush();
  await assert.rejects(f.app.configure({ ...DEFAULT, enabled: true }), /Izin alarm/);
  assert.equal(f.app.settings().enabled, false); f.controller.disconnect();
});

test('an account change and logout are delivered to native rather than enabling another account', async () => {
  const f = fixture(); let identity = 'first'; f.app.account = () => identity;
  const c = channel(f.controller); await flush(); identity = 'second'; await f.controller.poll(true);
  identity = null; await f.controller.poll(true);
  assert.deepEqual(c.requests.filter(r => r.method === 'bindAccount').map(r => r.identity), ['first', 'second', '']);
  assert.equal(c.requests.filter(r => r.method === 'configure').length, 0); f.controller.disconnect();
});

test('closing the native channel rejects pending saves without changing displayed settings', async () => {
  const f = fixture(); f.app.account = () => 'account';
  channel(f.controller, request => request.method === 'configure' ? undefined : state()); await flush();
  const pending = f.app.configure({ ...DEFAULT, enabled: true });
  f.controller.disconnect(); await assert.rejects(pending, /terputus/);
  assert.equal(f.app.settings().enabled, false);
});

test('reminder-only selection sends recordLocation false and no selected schedule feature stays disabled', async () => {
  const f = fixture({ scheduler: false }); f.app.account = () => 'account';
  const c = channel(f.controller, request => state(request.config || {})); await flush();
  await f.app.configure({ ...DEFAULT, enabled: true });
  assert.equal(c.requests.find(r => r.method === 'configure').config.recordLocation, false); f.controller.disconnect();
  const disabled = fixture({ scheduler: false, reminders: false }); disabled.app.account = () => 'account';
  await assert.rejects(disabled.app.configure({ ...DEFAULT, enabled: true }), /tidak dipilih/);
});

test('late status from a disconnected channel cannot replace the new native snapshot', async () => {
  const f = fixture(); let respond;
  channel(f.controller, () => new Promise(resolve => { respond = resolve; })); await flush();
  f.controller.disconnect(); await flush();
  channel(f.controller, () => state({ inTime: '08:00' })); await flush();
  respond(state({ enabled: true, inTime: '09:00' })); await flush();
  assert.equal(f.app.settings().inTime, '08:00'); assert.equal(f.app.settings().enabled, false);
  f.controller.disconnect();
});

test('a native configuration without registered alarms reports the partial failure', async () => {
  const f = fixture(); f.app.account = () => 'account';
  channel(f.controller, request => ({ ...state(request.config || {}), nextIn: 0, nextOut: 0 })); await flush();
  await assert.rejects(f.app.configure({ ...DEFAULT, enabled: true }), /alarm belum terdaftar/);
  assert.equal(f.app.settings().enabled, true); assert.equal(f.app.diagnostics().native.nextIn, 0);
  f.controller.disconnect();
});

test('concurrent native saves are refused until the first acknowledgement', async () => {
  const f = fixture(); f.app.account = () => 'account'; let respond;
  channel(f.controller, request => request.method === 'configure' ? new Promise(resolve => { respond = resolve; }) : state()); await flush();
  const save = f.app.configure({ ...DEFAULT, enabled: true }); await flush();
  await assert.rejects(f.app.configure({ ...DEFAULT, enabled: true }), /Tunggu/);
  respond(state({ enabled: true })); await save; assert.equal(f.controller.saving, false); f.controller.disconnect();
});
