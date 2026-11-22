/* SPDX-License-Identifier: GPL-3.0-only */
(function (root) {
  'use strict';
  function mount() {
    const app = root.DikaOffline, Core = root.DikaScheduleCore;
    if (!app || !Core || document.getElementById('dika-schedule')) return;
    const host = document.createElement('div'); host.id = 'dika-schedule';
    // Isolate typography and controls from GreatDay's global h3/button rules,
    // while inheriting the application's actual color tokens and font.
    host.style.fontFamily = getComputedStyle(document.body).fontFamily;
    const view = host.attachShadow({ mode: 'open' });
    view.innerHTML = `<style>
      :host{--accent:var(--ion-color-primary,#f68a22);--surface:var(--gd-comp-color-bg-2,#fff);--soft:var(--gd-comp-color-bg-1,#f0f2f4);--ink:var(--ion-text-color,#292b33);--muted:color-mix(in srgb,var(--ink) 78%,var(--surface));--on-accent:#000;font-family:inherit;font-size:14px;line-height:1.45;color:var(--ink);color-scheme:light dark}
      *,*::before,*::after{box-sizing:border-box}button,input{font-family:inherit}button{cursor:pointer}button:disabled{cursor:wait;opacity:.65}button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
      #dika-open{position:fixed;right:14px;top:calc(env(safe-area-inset-top,0px) + 56px);z-index:100000;display:flex;align-items:center;gap:7px;border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);border-radius:20px;padding:9px 13px;background:var(--surface);color:var(--accent-ink,var(--accent));font-size:12px;font-weight:650;box-shadow:0 3px 14px #0000000d}
      svg{display:block;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      #dika-panel{position:fixed;inset:0;z-index:100001;display:grid;place-items:center;padding:20px;background:#151a244d;opacity:0;transition:opacity .2s ease}#dika-panel[hidden]{display:none}#dika-panel[data-open]{opacity:1}
      #dika-card{position:relative;width:min(100%,400px);max-height:min(90dvh,700px);display:flex;flex-direction:column;overflow:hidden;border-radius:24px;background:var(--surface);box-shadow:0 24px 80px #10182826;transform:translateY(16px);transition:transform .26s cubic-bezier(.32,.72,0,1)}[data-open] #dika-card{transform:translateY(0)}
      header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:22px 22px 15px}h2,h3,p{margin:0}h2{font-size:20px;font-weight:700;letter-spacing:-.3px;line-height:1.25}.subtitle{color:var(--muted);font-size:12px;margin-top:5px}#dika-close{display:grid;place-items:center;flex-shrink:0;width:32px;height:32px;border:0;border-radius:50%;background:var(--soft);color:var(--ink)}
      .scroll{overflow-y:auto;overscroll-behavior:contain;padding:0 22px 16px}.pending{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;padding:13px 14px;border-radius:14px;border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);background:color-mix(in srgb,var(--accent) 10%,var(--surface))}.pending strong{display:block;font-size:13px;font-weight:650}.pending p{font-size:11px;color:var(--muted);margin-top:3px}.pending[hidden]{display:none}#dika-send{flex-shrink:0;border:0;border-radius:10px;padding:9px 12px;background:var(--accent);color:var(--on-accent);font-size:12px;font-weight:650}button#dika-send:disabled{opacity:.6}.switch-row{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--soft);border-radius:14px;padding:13px 14px;margin-bottom:18px}.switch-label{display:block;font-size:14px;font-weight:650}.switch-caption{font-size:11px;color:var(--muted);margin-top:2px}
      .switch{position:relative;display:block;flex:0 0 42px;width:42px;height:26px}.switch input{position:absolute;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}.track{display:block;height:26px;border-radius:20px;background:#b7bbc2;transition:background .2s ease;pointer-events:none}.track::after{content:'';position:absolute;left:3px;top:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0002;transition:transform .2s ease}.switch input:checked+.track{background:var(--accent)}.switch input:checked+.track::after{transform:translateX(16px)}.switch input:focus-visible+.track{outline:2px solid var(--accent);outline-offset:3px}
      .times{display:grid;grid-template-columns:1fr 1fr;gap:12px}.time-field{position:relative;display:block;padding:12px 13px;border:1px solid var(--soft);border-radius:14px;min-width:0}.time-label{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12px;margin-bottom:5px}.time-label svg{width:14px;height:14px}.time-display{display:flex;align-items:center;justify-content:space-between;min-height:34px;gap:6px;pointer-events:none}.time-value{font-size:25px;font-weight:600;line-height:1.3;font-variant-numeric:tabular-nums;letter-spacing:-.3px}.time-display svg{width:14px;height:14px;color:var(--muted)}input[type=time]{position:absolute;inset:0;width:100%;height:100%;min-width:0;opacity:0;cursor:pointer}.time-field:focus-within{outline:2px solid var(--accent);outline-offset:2px}
      fieldset{border:0;margin:18px 0 0;padding:0;min-width:0}legend{font-size:12px;font-weight:600;padding:0;margin-bottom:10px;color:var(--muted)}#dika-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}.day{position:relative}.day input{position:absolute;inset:0;margin:0;width:100%;height:100%;opacity:0;cursor:pointer}.day span{display:grid;place-items:center;min-height:40px;border:1px solid var(--soft);border-radius:11px;font-size:11px;font-weight:600;background:var(--surface);transition:background .18s ease,color .18s ease,border-color .18s ease}.day input:checked+span{background:color-mix(in srgb,var(--accent) 12%,var(--surface));color:var(--ink);border-color:color-mix(in srgb,var(--accent) 35%,var(--surface))}.day input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}
      #dika-ready{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);margin-top:14px}#dika-ready::before{content:'';width:6px;height:6px;border-radius:50%;background:#a4aab3}#dika-ready[data-ready]::before{background:#32a674}
      #dika-state{font-size:12px;margin-top:8px}#dika-state p+p{margin-top:6px}
      #dika-queue{list-style:none;padding:0;margin:10px 0 0;max-height:155px;overflow-y:auto}#dika-queue li{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--soft);font-size:11px;line-height:1.4}#dika-queue .log-time{margin:0}
      button.export{margin:10px 0 0;padding:9px 12px;border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);border-radius:10px;background:var(--surface);color:var(--ink);font-size:12px;font-weight:650}#dika-diag{margin:10px 0 0;padding:10px;border-radius:10px;background:var(--soft);font-size:10px;line-height:1.5;overflow-x:auto;white-space:pre-wrap;max-height:220px;overflow-y:auto}
      details{border-top:1px solid var(--soft);margin-top:17px;padding-top:14px}summary{font-size:12px;font-weight:600;cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between}summary::after{content:'+';color:var(--muted);font-size:16px}details[open] summary::after{content:'−'}#dika-log{list-style:none;padding:0;margin:10px 0 0;max-height:155px;overflow-y:auto}#dika-log li{padding:8px 0;border-bottom:1px solid var(--soft);font-size:11px;line-height:1.4}.log-line{display:flex;justify-content:space-between;gap:10px}.log-time{font-size:10px;color:var(--muted);margin-top:3px}.empty{color:var(--muted);font-size:11px;margin-top:9px}
      footer{padding:12px 22px calc(18px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--soft)}#dika-save{display:block;width:100%;height:44px;padding:0 15px;border:0;border-radius:12px;background:var(--accent);color:var(--on-accent);font-size:14px;font-weight:650;transition:filter .15s ease,transform .15s ease}#dika-save:active{transform:scale(.985);filter:brightness(.96)}#dika-message{min-height:16px;font-size:11px;color:var(--muted);margin:8px 0 0;text-align:center}#dika-message:empty{display:none}#dika-message[data-error]{color:color-mix(in srgb,#c34832 30%,var(--ink))}.hint{font-size:10px;color:var(--muted);margin-top:12px;line-height:1.5}
      .trial-note{padding:11px 12px;margin-bottom:14px;border:1px solid color-mix(in srgb,var(--accent) 40%,var(--surface));border-radius:12px;background:color-mix(in srgb,var(--accent) 10%,var(--surface));font-size:11px}.trial-note strong{display:block}.tool-actions{display:flex;flex-wrap:wrap;gap:8px}.tool-actions button{margin-top:10px}#dika-tool-notice{font-size:11px;margin-top:8px;color:var(--muted)}
      @media(max-width:480px){#dika-panel{padding:14px;align-items:center}#dika-card{width:100%;max-height:calc(100dvh - 28px)}header{padding-top:20px}}
      @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
    </style>
    <button id="dika-open" type="button" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>Jadwal</button>
    <div id="dika-panel" hidden>
      <section id="dika-card" role="dialog" aria-modal="true" aria-labelledby="dika-title">
        <header><div><h2 id="dika-title">Jadwal</h2><p class="subtitle">${app.features.scheduler ? 'WITA · toleransi 15 menit' : 'WITA'}</p></div><button id="dika-close" type="button" aria-label="Tutup"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
        <div class="scroll">${app.trial ? '<div class="trial-note" role="note"><strong>Build uji · pengiriman server ditahan</strong>' + (app.features.nativeTrial ? 'Jadwal native menyimpan lokasi sementara di patch. Hook GreatDay belum terhubung; hasil uji bukan catatan kehadiran GreatDay.' : 'Catatan tetap tersimpan di GreatDay. Reset dapat menambah catatan kehadiran.') + '</div>' : ''}<div class="pending" id="dika-pending" hidden><div><strong id="dika-pending-title"></strong><p id="dika-pending-text"></p></div><button id="dika-send" type="button">Kirim sekarang</button></div><form id="dika-form">
          <div class="switch-row"><div><label class="switch-label" for="dika-enabled">${app.features.nativeTrial ? 'Uji jadwal native' : app.features.scheduler ? 'Absen otomatis' : 'Pengingat aktif'}</label></div><label class="switch"><input id="dika-enabled" type="checkbox" role="switch" aria-label="Absen terjadwal"><span class="track"></span></label></div>
          <div class="times"><label class="time-field"><span class="time-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3m-7 6H2m20 0h-3M5 5l2 2m12-2-2 2"/><path d="M5 18a7 7 0 0 1 14 0M2 21h20"/></svg>Masuk</span><span class="time-display" aria-hidden="true"><span class="time-value" id="dika-in-display"></span><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg></span><input id="dika-in" type="time" required aria-label="Jam masuk"></label><label class="time-field"><span class="time-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z"/></svg>Pulang</span><span class="time-display" aria-hidden="true"><span class="time-value" id="dika-out-display"></span><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg></span><input id="dika-out" type="time" required aria-label="Jam pulang"></label></div>
          <fieldset><legend>Hari kerja</legend><div id="dika-days"></div></fieldset>
          ${app.features.scheduler ? '<p class="hint">' + (app.features.nativeTrial ? 'Satu percobaan masuk dan pulang per akun per hari WITA. Perubahan jam tidak membuka percobaan kedua. GPS mati atau izin kurang memerlukan pemeriksaan pengguna.' : app.trial ? 'Build uji: perubahan jam dapat menambah catatan hari ini. Gunakan reset untuk mengulang jam yang sama.' : 'Satu masuk dan satu pulang per hari. Mengubah jam tidak mengulang percobaan yang sudah tercatat.') + '</p>' : ''}
        </form><p id="dika-ready"></p>
        ${app.features.nativeTrial ? '<details open><summary>Status jadwal native</summary><p id="dika-native-status" class="hint" role="status">Menunggu sambungan native.</p><button id="dika-native-permissions" type="button" class="export">Periksa izin native</button><p class="hint">Setelah restart, jadwal dipulihkan setelah kunci perangkat pertama kali dibuka. Setelah Force stop, buka GreatDay kembali.</p></details>' : ''}
        <div id="dika-state" role="status"></div><details><summary>Catatan offline <span id="dika-queue-count"></span></summary><ol id="dika-queue"></ol><p id="dika-queue-empty" class="empty">Belum diperiksa.</p><p id="dika-sync-state" class="log-time"></p></details>
        ${app.features.diagnostics || app.trial ? `<details><summary>Riwayat <span id="dika-count"></span></summary><ol id="dika-log"></ol><p id="dika-empty" class="empty">Belum ada catatan.</p><button id="dika-clear-history" type="button" class="export">Bersihkan riwayat</button></details>
        <details><summary>Diagnostik</summary><button id="dika-export" type="button" class="export">Ekspor diagnostik</button><pre id="dika-diag" hidden></pre></details>` : ''}

        ${app.trial && !app.features.nativeTrial ? '<details id="dika-trial-tools"><summary>Uji coba</summary><p class="hint">Reset hanya pengunci hari ini. Catatan offline GreatDay tidak dihapus.</p><div class="tool-actions"><button id="dika-reset-in" type="button" class="export">Reset masuk</button><button id="dika-reset-out" type="button" class="export">Reset pulang</button></div></details>' : ''}
        <p id="dika-tool-notice" role="status"></p></div>
        <footer><button id="dika-save" type="submit" form="dika-form">Simpan jadwal</button><p id="dika-message" role="status" aria-live="polite"></p></footer>
      </section>
    </div>`;
    document.body.appendChild(host);
    const $ = id => view.getElementById('dika-' + id);
    // Keep the host application's surfaces/accent. Text contrast belongs to
    // this custom panel; do not change Morphe or GreatDay global styles.
    function updateContrast() {
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = getComputedStyle($('save')).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const channels = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => {
        const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      });
      const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      host.style.setProperty('--on-accent', (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#000' : '#fff');
      const accent = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      ctx.fillStyle = getComputedStyle($('card')).backgroundColor; ctx.fillRect(0, 0, 1, 1);
      const surface = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      const light = rgb => rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((a,v,i) => a + v * [.2126,.7152,.0722][i], 0);
      const bg = light(surface), end = bg > .179 ? 0 : 255;
      for (let step = 0; step <= 100; step++) {
        const rgb = accent.map(v => Math.round(v + (end - v) * step / 100)), ink = light(rgb);
        if ((Math.max(ink, bg) + .05) / (Math.min(ink, bg) + .05) >= 4.5) {
          host.style.setProperty('--accent-ink', 'rgb(' + rgb.join(',') + ')'); break;
        }
      }
    }
    updateContrast();
    new MutationObserver(updateContrast).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    new MutationObserver(updateContrast).observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateContrast);
    const hasSchedule = app.features.scheduler || app.features.reminders;
    $('form').hidden = !hasSchedule; $('save').hidden = !hasSchedule;
    if (!hasSchedule) $('title').textContent = 'Absensi';
    const names = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    const fullNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
    names.forEach((name, i) => {
      const label = document.createElement('label'); label.className = 'day';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = String(i + 1); input.setAttribute('aria-label', fullNames[i]);
      const span = document.createElement('span'); span.textContent = name; label.append(input, span); $('days').appendChild(label);
    });
    function populate() {
      const c = app.settings();
      $('enabled').checked = c.enabled; $('in').value = c.inTime; $('out').value = c.outTime;
      $('in-display').textContent = c.inTime; $('out-display').textContent = c.outTime;
      $('days').querySelectorAll('input').forEach(el => { el.checked = c.days.includes(+el.value); });
    }
    for (const slot of ['in', 'out']) {
      $(slot).oninput = () => { $(slot + '-display').textContent = $(slot).value || '—:—'; };
      $(slot).onclick = () => { try { $(slot).showPicker?.(); } catch (_) { /* Native focus remains available. */ } };
    }
    $('send').hidden = app.trial;
    const statusLabels = { 'reset-test': 'Reset uji', running: 'Berjalan', 'needs-user': 'Perlu diperiksa', 'stored-offline': 'Tersimpan offline', interrupted: 'Terputus', 'dummy-saved': 'Lokasi sementara tersimpan · hook belum terhubung', 'reminder-delivered': 'Pengingat native ditampilkan' };
    const scheduleLabels = {
      disabled: 'Nonaktif', 'off-day': 'Bukan hari kerja', reminder: 'Pengingat aktif; pencatatan otomatis tidak dipilih', scheduled: 'Menunggu jadwal', missed: 'Lewat toleransi 15 menit',
      waiting: 'Menunggu pencatatan', running: 'Sedang mencatat', 'needs-user': 'Perlu diperiksa; tidak diulang otomatis',
      'already-attempted': 'Sudah dicoba hari ini; perubahan jam tidak mengulang',
      interrupted: 'Percobaan terputus; periksa GreatDay', queued: 'Tersimpan di antrean offline; belum berarti diterima server',
      'saved-unchecked': 'Pernah tersimpan offline; antrean belum terverifikasi',
      'queue-missing': 'Catatan sudah tidak ada di antrean; penerimaan server belum terverifikasi'
      , 'dummy-saved': 'Lokasi sementara tersimpan di patch; belum menjadi absensi GreatDay', 'reminder-delivered': 'Pengingat ditampilkan'
    };
    let nativeConfigSignature = '';
    app.render = () => {
      const waiting = app.pendingCount || 0;
      $('pending').hidden = !waiting;
      if (waiting) {
        $('pending-title').textContent = waiting + (app.trial ? ' kehadiran ditahan build uji' : ' kehadiran menunggu konfirmasi');
        $('pending-text').textContent = 'Tersimpan offline di GreatDay, belum dikirim ke server.';
      }
      const snapshot = app.diagnostics();
      if (app.features.nativeTrial) {
        const native = snapshot.native || {}, permissions = native.permissions || {};
        const signature = JSON.stringify(app.settings());
        if (signature !== nativeConfigSignature) { nativeConfigSignature = signature; populate(); }
        $('save').disabled = !app.nativeController?.ready || app.nativeController?.saving;
        $('native-permissions').disabled = !app.nativeController?.port;
        const next = at => at ? new Date(at).toLocaleString('id-ID', { timeZone: Core.ZONE }) + ' WITA' : 'belum terdaftar';
        $('native-status').textContent = native.error || (!native.permissions ? 'Menunggu sambungan native.' :
          `Masuk: ${next(native.nextIn)}. Pulang: ${next(native.nextOut)}. ` +
          `Alarm: ${permissions.exactAlarm ? 'diizinkan' : 'perlu izin'}. Notifikasi: ${permissions.notifications ? 'diizinkan' : 'perlu izin'}. ` +
          `${permissions.locationProblem || 'Lokasi siap untuk uji'}. ${native.dummyCount || 0} hasil sementara tersimpan. Hook GreatDay belum terhubung.`);
        if ($('clear-history')) $('clear-history').hidden = true;
      }
      const queue = snapshot.queueIds || [];
      const held = new Set(snapshot.pendingIds);
      $('queue-count').textContent = queue.length ? String(queue.length) : '';
      $('queue-empty').hidden = queue.length > 0;
      $('queue-empty').textContent = snapshot.queueIds === null ? 'Belum diperiksa.' : 'Tidak ada catatan offline.';
      const qList = $('queue'); qList.textContent = '';
      for (const id of queue) {
        const row = document.createElement('li'), label = document.createElement('span'), state = document.createElement('span');
        label.textContent = 'Catatan #' + id;
        state.className = 'log-time'; state.textContent = app.trial ? 'Ditahan build uji' : held.has(id) ? 'Menunggu kirim' : 'Tersimpan offline';
        row.append(label, state); qList.appendChild(row);
      }
      $('sync-state').textContent = app.trial ? 'Pengiriman ke server dinonaktifkan pada build uji.' : waiting ? waiting + ' catatan menunggu konfirmasi kirim.' : '';
      for (const id of ['reset-in','reset-out','clear-history']) if ($(id)) $(id).disabled = !app.engine || !!app.active || !!app.engine.busy;
      const ready = snapshot.readiness;
      $('ready').textContent = app.features.scheduler ? (ready || 'Siap · lokasi tanpa kamera') : (snapshot.accountKnown ? 'Akun GreatDay aktif' : 'Menunggu akun GreatDay');
      $('ready').toggleAttribute('data-ready', !ready && app.features.scheduler);
      $('state').textContent = '';
      for (const item of snapshot.scheduleState || []) {
        const line = document.createElement('p');
        line.textContent = `${item.slot === 'in' ? 'Masuk' : 'Pulang'} ${item.scheduled} · ${scheduleLabels[item.state] || item.state}`;
        $('state').appendChild(line);
      }
      $('message').textContent = $('message').hasAttribute('data-error') ? app.notice : '';
      if (!app.features.diagnostics && !app.trial) return;
      const items = (app.features.nativeTrial ? snapshot.native?.history || [] : app.engine?.history || []).slice(-Core.HISTORY_LIMIT).reverse();
      $('count').textContent = items.length ? String(items.length) : '';
      $('empty').hidden = items.length > 0;
      const list = $('log'); list.textContent = '';
      for (const item of items) {
        const row = document.createElement('li'), line = document.createElement('div'), status = document.createElement('span'), time = document.createElement('p');
        const entry = app.engine?.ledger[item.key];
        const scheduled = item.scheduled || entry?.scheduled, slot = item.slot || entry?.slot;
        line.className = 'log-line'; status.textContent = (scheduled ? `${slot === 'out' ? 'Pulang' : 'Masuk'} ${scheduled} · ` : '') + (statusLabels[item.status] || item.status); line.append(status);
        time.className = 'log-time'; time.textContent = new Date(item.at).toLocaleString('id-ID', { timeZone: Core.ZONE }); row.title = item.message; row.append(line, time);
        if (app.features.nativeTrial) { const detail = document.createElement('p'); detail.className = 'log-time'; detail.textContent = item.message; row.appendChild(detail); }
        list.appendChild(row);
      }
    };
    let closeTimer, previousFocus, appRoot, previousInert;
    function open() {
      clearTimeout(closeTimer); previousFocus = document.activeElement;
      appRoot = document.querySelector('app-root'); previousInert = appRoot?.inert;
      if (appRoot) appRoot.inert = true;
      populate(); app.render(); app.refreshQueue(true).catch(() => {}); $('panel').hidden = false; $('open').setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => { $('panel').setAttribute('data-open', ''); $('close').focus(); });
    }
    function close() {
      $('panel').removeAttribute('data-open'); $('open').setAttribute('aria-expanded', 'false');
      if (appRoot) appRoot.inert = previousInert;
      closeTimer = setTimeout(() => { $('panel').hidden = true; }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 210);
      if (previousFocus && previousFocus !== host) previousFocus.focus(); else $('open').focus();
    }
    function toolAction(message, action) {
      if (!root.confirm(message)) return;
      try { action(); $('tool-notice').textContent = app.notice; }
      catch (error) { $('tool-notice').textContent = error.message || 'Tindakan belum dapat dilakukan.'; }
    }
    if ($('native-permissions')) $('native-permissions').onclick = async () => {
      try { await app.nativeController.request('permissions'); }
      catch (error) { $('tool-notice').textContent = error.message; }
    };
    if ($('clear-history')) $('clear-history').onclick = () => toolAction('Bersihkan riwayat panel? Pengunci percobaan dan catatan GreatDay tetap disimpan.', () => app.clearHistory());
    for (const slot of ['in','out']) if ($('reset-' + slot)) $('reset-' + slot).onclick = () => toolAction(
      'Reset percobaan ' + (slot === 'in' ? 'masuk' : 'pulang') + ' hari ini? Percobaan berikutnya dapat menambah kehadiran asli. Catatan GreatDay tidak dihapus.', () => app.resetTrial(slot));
    $('send').onclick = () => {
      $('send').disabled = true;
      try { app.confirmSend(); } catch (error) {
        app.notice = error.message || 'Pengiriman belum bisa dimulai.';
        $('message').setAttribute('data-error', ''); app.render();
      } finally { $('send').disabled = false; }
    };
    if ($('export')) $('export').onclick = async () => {
      $('diag').hidden = false;
      $('diag').textContent = JSON.stringify(app.diagnostics(), null, 2);
      const text = $('diag').textContent;
      try {
        if (root.navigator?.share) { await root.navigator.share({ title: 'Diagnostik Morphe', text }); return; }
        throw Error('share unavailable');
      } catch (_) {
        try { await root.navigator?.clipboard?.writeText(text); app.notice = 'Diagnostik disalin ke papan klip.'; }
        catch (_) { app.notice = 'Diagnostik ditampilkan di bawah; salin manual.'; }
        app.render();
      }
    };
    app.onPending = () => { if ($('panel').hidden) open(); };
    // Show Morphe Settings in the menu: a GreatDay-styled entry inside the
    // app's own side menu opens the panel. Angular re-renders the menu, so a
    // MutationObserver re-adds the entry whenever it disappears.
    function addMenuEntry() {
      const menu = document.querySelector('ion-menu');
      const list = menu && (menu.querySelector('ion-content ion-list') || menu.querySelector('ion-list') || menu.querySelector('ion-content'));
      if (!list || list.querySelector('[data-dika-entry]')) return;
      const item = document.createElement('ion-item');
      item.setAttribute('button', ''); item.setAttribute('lines', 'none'); item.setAttribute('data-dika-entry', '');
      const label = document.createElement('ion-label');
      label.textContent = 'Jadwal (Morphe)';
      item.appendChild(label);
      item.addEventListener('click', () => {
        try { menu.close(); } catch (_) { /* GreatDay may manage its own close. */ }
        setTimeout(open, 250);
      });
      list.appendChild(item);
    }
    if (typeof MutationObserver === 'function') {
      new MutationObserver(addMenuEntry).observe(document.documentElement, { childList: true, subtree: true });
    }
    addMenuEntry();
    $('open').onclick = open; $('close').onclick = close;
    $('panel').onclick = event => { if (event.target === $('panel')) close(); };
    $('panel').onkeydown = event => {
      if (event.key === 'Escape') close();
      if (event.key !== 'Tab') return;
      const elements = [...$('card').querySelectorAll('button,input,summary')].filter(el => !el.disabled && el.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && view.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && view.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    $('form').onsubmit = async event => {
      event.preventDefault(); $('save').disabled = true; $('message').removeAttribute('data-error'); $('message').textContent = '';
      try {
        await app.configure({ enabled: $('enabled').checked, inTime: $('in').value, outTime: $('out').value,
          days: [...$('days').querySelectorAll('input:checked')].map(el => +el.value) });
        populate();
        close();
      } catch (error) { app.notice = error.message || 'Jadwal belum tersimpan.'; $('message').setAttribute('data-error', ''); app.render(); }
      finally { $('save').disabled = false; }
    };
    app.render();
    setInterval(() => { app.poll(); }, 1000);
    document.addEventListener('visibilitychange', () => {
      app.poll();
      if (document.visibilityState === 'visible') app.refreshNotifications(false).catch(() => {});
    });
    app.poll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})(globalThis);
