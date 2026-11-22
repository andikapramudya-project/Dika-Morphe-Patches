/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.greatday.nativebridge;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

final class NativeScheduler {
    static final String ACTION = "app.dika.greatday.NATIVE_ATTENDANCE";
    static final String[] SLOTS = {"in", "out"};
    private NativeScheduler() {}
    private static PendingIntent pending(Context c, String slot, long at, String revision) {
        Intent i = new Intent(c, AttendanceAlarmReceiver.class).setAction(ACTION + "." + slot)
                .putExtra("slot", slot).putExtra("scheduledAt", at).putExtra("revision", revision);
        return PendingIntent.getBroadcast(c, "in".equals(slot) ? 910701 : 911901, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static void cancel(Context c) {
        AlarmManager alarms = c.getSystemService(AlarmManager.class);
        for (String slot : SLOTS) alarms.cancel(pending(c, slot, 0, ""));
    }
    static void rearm(Context c) {
        NativeStore store = new NativeStore(c);
        long previousIn = store.expected("in"), previousOut = store.expected("out");
        cancel(c);
        store.expected("in", 0); store.expected("out", 0);
        if (!store.enabled()) return;
        if (!Prerequisites.exact(c)) {
            store.event("system", "exact-permission-required", "Izin Alarm & pengingat belum diberikan; tidak memakai alarm perkiraan.");
            return;
        }
        JSONObject config = store.config();
        try {
            long now = System.currentTimeMillis();
            for (String slot : SLOTS) {
                long at = SchedulePlan.next(now, config.getString(slot + "Time"), config.getInt("daysMask"));
                long previous = "in".equals(slot) ? previousIn : previousOut;
                if (SchedulePlan.isDue(now, previous) && !store.attempt(SchedulePlan.key(
                        config.getString("accountHash"), slot, previous)).has("key")) at = previous;
                store.expected(slot, at); // Persist verification material before handing the alarm to Android.
                c.getSystemService(AlarmManager.class).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at,
                        pending(c, slot, at, config.getString("revision")));
            }
        } catch (Exception e) {
            cancel(c); store.expected("in", 0); store.expected("out", 0);
            store.event("system", "schedule-failed", "Pendaftaran alarm native gagal. Periksa izin dan simpan ulang jadwal.");
        }
    }
}
