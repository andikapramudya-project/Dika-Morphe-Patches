/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.greatday.nativebridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

public final class AttendanceAlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        NativeStore store = new NativeStore(context);
        String key = null;
        try {
            String slot = intent.getStringExtra("slot"), revision = intent.getStringExtra("revision");
            long at = intent.getLongExtra("scheduledAt", 0);
            if ((!"in".equals(slot) && !"out".equals(slot)) || !store.enabled()
                    || !store.revision().equals(revision) || !intent.getAction().equals(NativeScheduler.ACTION + "." + slot)
                    || store.expected(slot) != at) return;
            JSONObject config = store.config();
            key = SchedulePlan.key(config.getString("accountHash"), slot, at);
            if (!SchedulePlan.isDue(System.currentTimeMillis(), at)) {
                store.event(key, "outside-window", "Pemicu di luar toleransi; waktu absensi tidak dimundurkan.");
                NativeScheduler.rearm(context); return;
            }
            // Main-thread broadcast/service/bridge callbacks serialize reservations in this process.
            boolean reserved = store.reserve(key, slot, at, revision);
            NativeScheduler.rearm(context);
            if (!reserved) return;
            if (!new NativePolicy(context).scheduler() || !config.optBoolean("recordLocation", true)) {
                store.finish(key, "reminder-delivered", "Pengingat native; pencatatan lokasi tidak dipilih.");
                NativeNotifications.show(context, "Pengingat absen " + ("in".equals(slot) ? "masuk" : "pulang"),
                        "Buka GreatDay untuk mencatat. Pengiriman offline tetap ditahan build uji.", true); return;
            }
            String problem = Prerequisites.locationProblem(context);
            if (!Prerequisites.notifications(context)) problem = "Notifikasi belum diizinkan; uji lokasi otomatis dibatalkan.";
            if (problem != null) {
                store.finish(key, "needs-user", problem);
                NativeNotifications.show(context, "Uji jadwal perlu perhatian", problem, true); return;
            }
            Intent service = new Intent(context, AttendanceForegroundService.class)
                    .putExtra("key", key).putExtra("revision", revision);
            context.startForegroundService(service);
        } catch (Exception e) {
            try {
                if (key != null) store.finish(key, "needs-user", "Layanan native gagal dimulai; periksa izin dan status patch.");
                NativeNotifications.show(context, "Uji jadwal belum berjalan", "Buka panel Jadwal untuk memeriksa izin.", true);
            } catch (Exception ignored) { /* Never crash the host for a trial alarm. */ }
        }
    }
}
