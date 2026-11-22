#!/usr/bin/env python3
"""Read-only asset compatibility check; does not rebuild, sign or install APKs."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESOURCE = ROOT / 'patches/src/main/resources/greatday8'
TRIAL = 'private const val TRIAL_BUILD = true' in (ROOT / 'patches/src/main/kotlin/app/dika/patches/greatday/OfflineSchedulePatch.kt').read_text()
PREVIEW = 'this.defaultTimeoutAtt=5}ngOnInit(){'
OFFLINE = 'ngOnInit(){this.params=this.navigationService.getParams()||this.navParams.get("params")}'


def once(text, anchor, replacement):
    if text.count(anchor) != 1:
        raise ValueError(f'Expected exactly one hook: {anchor}')
    return text.replace(anchor, replacement)


def transform(path, text):
    if path == 'assets/capacitor.config.json':
        config = json.loads(text)
        if TRIAL:
            config.setdefault('android', {})['useLegacyBridge'] = True
        return json.dumps(config)
    if path.endswith('index.html'):
        return once(text, '</head>', '<script src="dika/features.js"></script><script src="dika/core.js"></script><script src="dika/runtime.js"></script><script src="dika/background.js"></script><script src="dika/native.js"></script><script src="dika/ui.js"></script></head>')
    if '61543.' in path:
        text = once(text, 'this.livenessGestureStatus=!1}get googlePlayServicesAvailable(){',
                    'this.livenessGestureStatus=!1;globalThis.DikaOffline?.attachMachine(this);}get googlePlayServicesAvailable(){')
        if TRIAL:
            text = once(text, 'getCurrentTime(){return new Promise(X=>{var J;this.attendanceApi.getCurrentTime()',
                        'getCurrentTime(){if(globalThis.DikaOffline?.backgroundRunner?.useOfflineDeviceTime(this))return Promise.resolve((new Date).toISOString());return new Promise(X=>{var J;this.attendanceApi.getCurrentTime()')
        text = once(text, 'this.previousRouteData=""}get previousRoute(){',
                    'this.previousRouteData="";globalThis.DikaOffline?.attachNavigation(this);}get previousRoute(){')
        text = once(text, 'this.resultSyncOffline$=new i.Subject}get isSync(){',
                    'this.resultSyncOffline$=new i.Subject;globalThis.DikaOffline?.attachSync(this);}get isSync(){')
        text = once(text, 'J.hideMap||null!=X&&X.isAttendanceBarcode&&J.networkService.isOffline||J.networkService.isOffline',
                    'globalThis.DikaOffline?.requiresLocation(J)||J.hideMap||null!=X&&X.isAttendanceBarcode&&J.networkService.isOffline||J.networkService.isOffline')
        anchor = 'syncAttendanceOffline(w){var H=this;return(0,s.A)(function*(){try{if(H.stopSync||H.isSync)return;'
        trial = 'private const val TRIAL_BUILD = true' in (ROOT / 'patches/src/main/kotlin/app/dika/patches/greatday/OfflineSchedulePatch.kt').read_text()
        guard = 'globalThis.DikaOffline?.syncGate(w,H);return;' if trial else 'if(globalThis.DikaOffline&&globalThis.DikaOffline.syncGate(w,H)===false)return;'
        return once(text, anchor, anchor + guard)
    text = once(text, PREVIEW, PREVIEW + 'globalThis.DikaOffline?.attachPreview(this);')
    if '86035.' not in path:
        text = once(text, OFFLINE, OFFLINE[:-1] + ';globalThis.DikaOffline?.attachOffline(this);}')
        argument, receiver, record = ('f', 'v', 'b') if '19123.' in path else ('m', 'd', 'E')
        text = once(text, f'recordAttendance({argument}){{var {receiver}=this;',
                    f'recordAttendance({argument}){{const __dikaTicket=globalThis.DikaOffline?.ticketFor(this);var {receiver}=this;')
        text = once(text, f'{record}.attOn="offline",{receiver}.navigationService.pushSide(',
                    f'{record}.attOn="offline",globalThis.DikaOffline?.captured(__dikaTicket,{record}),{receiver}.navigationService.pushSide(')
    return text


def check(apk):
    expected = dict(line.split('=', 1) for line in (RESOURCE / 'targets.properties').read_text().splitlines() if line)
    with zipfile.ZipFile(apk) as archive, tempfile.TemporaryDirectory() as temp:
        for index, (path, digest) in enumerate(expected.items()):
            data = archive.read(path)
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError(f'Unsupported APK content: {path}')
            transformed = transform(path, data.decode('utf-8'))
            if path.endswith('.json') and TRIAL:
                config = json.loads(transformed)
                assert config['android']['useLegacyBridge'] is True
            if path.endswith('.js'):
                target = pathlib.Path(temp, f'chunk-{index}.js')
                target.write_text(transformed)
                subprocess.run(['node', '--check', str(target)], check=True)
                if '61543.' in path:
                    verify_location_flow(transformed, pathlib.Path(temp))
                    verify_device_time(transformed, pathlib.Path(temp))
                else:
                    verify_offline_store(transformed, pathlib.Path(temp))
            print(f'PASS {path}')
    print('Asset fingerprints, unique hooks, and modified JavaScript syntax passed. Device behavior is NOT verified.')


def verify_location_flow(text, directory):
    """Exercise ONLY isolated shipped methods against synthetic services, never the app."""
    start = text.index('recordAttendanceSimplyfied(X){')
    end = text.index('recordAttendanceForceValidation(X){', start)
    method = text[start:end]
    # Scope the camera search to the same attendance-machine class.
    start = text.index('getCamera(){', start)
    end = text.index('takePicture(){', start)
    camera = text[start:end]
    fixture = r'''
const assert = require('node:assert/strict');
const vm = require('node:vm');
const s = { A: generator => function(...args) {
  const iterator = generator.apply(this, args);
  return new Promise((resolve,reject) => {
    const step = (kind,value) => {
      let item; try { item=iterator[kind](value); } catch(error) {reject(error);return;}
      if(item.done)resolve(item.value);
      else Promise.resolve(item.value).then(v=>step('next',v),e=>step('throw',e));
    }; step('next');
  });
}};
(async()=>{
 for(const offline of [false,true]) for(const automatic of [false,true]) {
  let locations=0,photos=0;
  const scope={s,t:{},DikaOffline:{requiresLocation:()=>automatic}};
  const machine=vm.runInNewContext('({' + METHOD + ',' + CAMERA + '})',scope);
  Object.assign(machine,{
   hideMap:false,networkService:{isOffline:offline},deviceService:{isAndroid:true,isNative:true},
   attendanceSetting:{takePhoto:false},
   mockLocationService:{checkRoot:async()=>({isDetected:false}),checkMockLocation:async()=>({isDetected:false})},
   checkDeveloperOptions:async()=>({isDetected:false}),checkAutoTime:async()=>({isDetected:false}),
   getGeolocation:async()=>{locations++;return{cancelled:false};},
   cameraService:{cameraAttendance:async()=>{photos++;throw Error('Camera must not open');}},
   collectResponseData:async()=>({actualLocation:locations>0})
  });
  const result=await machine.recordAttendanceSimplyfied({isOnline:false,isAttendanceBarcode:false});
  assert.equal(locations,automatic||offline?1:0);assert.equal(photos,0);
  assert.equal(result.actualLocation,automatic||offline);
 }
 console.log('PASS isolated shipped location flow: online/offline, no camera, manual behavior preserved');
})().catch(error=>{console.error(error);process.exitCode=1;});
'''
    import json
    target = directory / 'location-flow.cjs'
    target.write_text('const METHOD=' + json.dumps(method) + ';const CAMERA=' + json.dumps(camera) + ';\n' + fixture, encoding='utf-8')
    subprocess.run(['node', str(target)], check=True)


def verify_device_time(text, directory):
    """Exercise the actual shipped time method; no server or device mutations."""
    start = text.index('getCurrentTime(){return new Promise(X=>') if not TRIAL else text.index('getCurrentTime(){if(globalThis.DikaOffline?.backgroundRunner?')
    method = text[start:text.index('confirmWithOutCamera(){}', start)]
    fixture = r'''
const assert=require('node:assert/strict'),vm=require('node:vm');
(async()=>{
 for(const owned of [false,true]) for(const attached of [false,true]) {
  let requests=0;
  const scope={p:{timeout:()=>null},s:{A:()=>{}},DikaOffline:attached?{backgroundRunner:{useOfflineDeviceTime:()=>owned}}:undefined};
  const machine=vm.runInNewContext('({'+METHOD+'})',scope);
  machine.attendanceApi={getCurrentTime(){requests++;return{pipe(){return{subscribe(observer){observer.error();}};}};}};
  const before=Date.now(),time=Date.parse(await machine.getCurrentTime());
  assert.ok(time>=before&&time<=Date.now(),'Actual current time, never the schedule time');
  assert.equal(requests,TRIAL&&owned&&attached?0:1);
 }
 console.log('PASS isolated shipped time: owned offline fallback uses actual clock; other requests unchanged');
})().catch(e=>{console.error(e);process.exitCode=1;});
'''
    target = directory / 'device-time.cjs'
    target.write_text('const METHOD=' + json.dumps(method) + ';const TRIAL=' + json.dumps(TRIAL) + ';\n' + fixture, encoding='utf-8')
    subprocess.run(['node', str(target)], check=True)


def verify_offline_store(text, directory):
    """Confirm the shipped offline save ignores online button/server selection."""
    import json
    start = text.index('saveAttendance(t){')
    save = text[start:text.index('saveOnlineAttendance(t){', start)]
    start = text.index('saveOfflineAttendance(){')
    store = text[start:text.index('saveBreakTime(t){', start)]
    fixture = r'''
const assert=require('node:assert/strict'),vm=require('node:vm');
const helper={A:generator=>function(...args){const iterator=generator.apply(this,args);return new Promise((resolve,reject)=>{
 const step=(kind,value)=>{let item;try{item=iterator[kind](value);}catch(e){reject(e);return;}
 if(item.done)resolve(item.value);else Promise.resolve(item.value).then(v=>step('next',v),e=>step('throw',e));};step('next');
});}};
(async()=>{
 const machine=vm.runInNewContext('({'+SAVE+','+STORE+'})',{h:helper,g:helper,p:helper,setTimeout:fn=>fn()});
 let saves=0,signals=0;
 Object.assign(machine,{params:{id:'synthetic-record',attOn:'offline'},isValidTime:true,
  navigationService:{back(){}},alertService:{presentAlertError(error){throw error;}},
  attendanceSyncService:{addFlagButton(){throw Error('Online button dependency');},
   saveAttendanceToStorage:async record=>{assert.equal(record.id,'synthetic-record');saves++;return[record];},
   responseFailed$:{next(){signals++;}}}});
 await machine.saveAttendance(0);assert.equal(saves,1);assert.equal(signals,1);assert.equal(machine.loadingSaveAttendance,false);
 console.log('PASS isolated shipped preview: offline storage without online button/server dependency');
})().catch(e=>{console.error(e);process.exitCode=1;});
'''
    target = directory / 'offline-save.cjs'
    target.write_text('const SAVE=' + json.dumps(save) + ';const STORE=' + json.dumps(store) + ';\n' + fixture, encoding='utf-8')
    subprocess.run(['node', str(target)], check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=pathlib.Path)
    check(parser.parse_args().apk)
