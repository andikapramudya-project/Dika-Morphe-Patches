/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.greatday.nativebridge;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.provider.Settings;
import org.json.JSONException;
import org.json.JSONObject;

final class Prerequisites {
    static boolean granted(Context c, String permission) {
        return c.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }
    static boolean exact(Context c) {
        return Build.VERSION.SDK_INT < 31 || c.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }
    static boolean notifications(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        android.app.NotificationChannel channel = nm.getNotificationChannel(NativeNotifications.CHANNEL);
        if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        return (Build.VERSION.SDK_INT < 33 || granted(c, Manifest.permission.POST_NOTIFICATIONS))
                && nm.areNotificationsEnabled();
    }
    static String locationProblem(Context c) {
        if (!granted(c, Manifest.permission.ACCESS_FINE_LOCATION)) return "Izin lokasi presisi belum diberikan.";
        if (Build.VERSION.SDK_INT >= 29 && !granted(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION))
            return "Izin lokasi Izinkan sepanjang waktu diperlukan untuk jadwal latar belakang.";
        LocationManager lm = c.getSystemService(LocationManager.class);
        if (lm == null || !lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) return "GPS mati. Aktifkan lokasi di pengaturan.";
        if (Settings.Global.getInt(c.getContentResolver(), Settings.Global.AUTO_TIME, 0) != 1)
            return "Aktifkan tanggal dan waktu otomatis sebelum uji lokasi.";
        return null;
    }
    static JSONObject status(Context c) throws JSONException {
        return new JSONObject().put("exactAlarm", exact(c)).put("notifications", notifications(c))
                .put("preciseLocation", granted(c, Manifest.permission.ACCESS_FINE_LOCATION))
                .put("backgroundLocation", Build.VERSION.SDK_INT < 29 || granted(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION))
                .put("locationProblem", locationProblem(c) == null ? JSONObject.NULL : locationProblem(c));
    }
}
