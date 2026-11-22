/* Synthetic native MessagePort host; no phone or company account is accessed. */
const { chromium } = require('playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const assets = path.resolve(__dirname, '../patches/src/main/resources/greatday8');
const output = path.resolve(__dirname, '../test-results'); fs.mkdirSync(output, { recursive: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:Arial,sans-serif;margin:0;background:#f0f2f4}:root{--ion-color-primary:#f68a22;--ion-text-color:#292b33;--gd-comp-color-bg-1:#f0f2f4;--gd-comp-color-bg-2:#fff}</style>
<script>window.DikaFeatures={trial:true,nativeTrial:true,scheduler:true,reminders:true,diagnostics:true};window.realCalls=0;window.permissionCalls=0;</script>
<script src="/core.js"></script><script src="/runtime.js"></script><script src="/native.js"></script><script src="/ui.js"></script></head>
<body><app-root><main style="padding:24px"><h1>GreatDay test host</h1><p>Native schedule fixture. No company data.</p></main></app-root><script>
const mode=new URLSearchParams(location.search).get('mode')||'healthy';
window.Capacitor={nativePromise:async(p,m)=>m==='getPending'?{notifications:[]}:({})};
DikaOffline.attachMachine({auth:{gdAuth:{id:'test-company',userId:'test-user'}},recordAttendance(){realCalls++;throw Error('Real recorder must not be called');}});
window.nativeState={mode:'native-dummy-trial',config:{enabled:false,zone:'Asia/Makassar',days:[1,2,3,4,5],inTime:'07:00',outTime:'19:00'},
today:{},nextIn:0,nextOut:0,history:[],dummyCount:0,permissions:{exactAlarm:true,notifications:true,preciseLocation:true,backgroundLocation:true,locationProblem:null},greatDayHook:'NOT_IMPLEMENTED',serverSendHeld:true};
if(mode!=='disconnected'){
 const pair=new MessageChannel();window.nativePort=pair.port1;
 pair.port1.onmessage=e=>{const r=JSON.parse(e.data);if(r.method==='pong')return;
  if(r.method==='configure'&&mode==='denied'){pair.port1.postMessage(JSON.stringify({id:r.id,error:'Izinkan Alarm & pengingat dan notifikasi, lalu simpan ulang.'}));return;}
  if(r.method==='configure'){nativeState.config=r.config;nativeState.nextIn=Date.parse('2026-11-09T07:00:00+08:00');nativeState.nextOut=Date.parse('2026-11-09T19:00:00+08:00');}
  if(r.method==='permissions')permissionCalls++;
  pair.port1.postMessage(JSON.stringify({id:r.id,result:nativeState}));};
 window.postMessage('dika-native-attendance-v1',location.origin,[pair.port2]);
}
</script></body></html>`;
(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
    for (const mode of ['healthy', 'denied', 'disconnected']) {
      const page = await browser.newPage({ viewport: { width: mode === 'healthy' ? 320 : 412, height: 820 }, locale: 'id-ID' });
      await page.route('https://localhost/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (['/core.js', '/runtime.js', '/native.js', '/ui.js'].includes(pathname))
          return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(assets, pathname.slice(1))) });
        return route.fulfill({ contentType: 'text/html', body: html });
      });
      const errors = []; page.on('pageerror', error => errors.push(String(error)));
      await page.goto('https://localhost/?mode=' + mode);
      await page.click('#dika-open');
      assert.equal(await page.inputValue('#dika-in'), '07:00'); assert.equal(await page.inputValue('#dika-out'), '19:00');
      assert.match(await page.locator('.trial-note').innerText(), /bukan catatan kehadiran GreatDay/);
      assert.equal(await page.locator('#dika-reset-in').count(), 0);
      if (mode === 'disconnected') {
        assert.equal(await page.locator('#dika-save').isDisabled(), true);
        assert.match(await page.locator('#dika-native-status').innerText(), /Menunggu/);
      } else {
        await page.waitForFunction(() => DikaOffline.nativeController.ready);
        await page.click('#dika-native-permissions'); await page.waitForFunction(() => permissionCalls === 1);
        await page.locator('#dika-enabled').check(); await page.click('#dika-save');
        if (mode === 'denied') {
          await page.waitForFunction(() => document.getElementById('dika-schedule').shadowRoot.getElementById('dika-message').textContent.includes('Izinkan Alarm'));
          assert.equal(await page.evaluate(() => DikaOffline.settings().enabled), false);
        } else {
          await page.waitForFunction(() => DikaOffline.settings().enabled);
          await page.waitForFunction(() => document.getElementById('dika-schedule').shadowRoot.getElementById('dika-panel').hidden);
          await page.click('#dika-open');
          await page.evaluate(async () => {
            nativeState.dummyCount=1;nativeState.today.in='dummy-saved';nativeState.history=[{at:Date.now(),slot:'in',status:'dummy-saved',message:'Lokasi hanya tersimpan sementara di patch.'}];
            await DikaOffline.nativeController.poll(true);await DikaOffline.poll();
          });
          assert.match(await page.locator('#dika-state').innerText(), /belum menjadi absensi GreatDay/);
          assert.match(await page.locator('#dika-native-status').innerText(), /1 hasil sementara/);
          assert.equal(await page.evaluate(() => DikaOffline.confirmSend()), false);
        }
      }
      assert.equal(await page.evaluate(() => realCalls), 0); assert.deepEqual(errors, []);
      await page.locator('#dika-panel').evaluate(el => Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
      const bounds = await page.locator('#dika-card').boundingBox(); assert.ok(bounds.x >= 0 && bounds.width <= (mode === 'healthy' ? 320 : 412));
      await page.screenshot({ path: path.join(output, 'native-' + mode + '.png') });
      await page.close(); console.log('PASS native browser: ' + mode);
    }
  } finally { if (browser) await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
