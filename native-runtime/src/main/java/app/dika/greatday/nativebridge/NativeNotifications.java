/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.greatday.nativebridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

final class NativeNotifications {
    static final int ID = 910719;
    static final String CHANNEL = "dika_native_trial_status";
    static Notification build(Context c, String title, String text, boolean attention) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(
                CHANNEL, "Uji jadwal native", NotificationManager.IMPORTANCE_DEFAULT));
        Intent settings = new Intent(c, NativePermissionActivity.class);
        PendingIntent open = PendingIntent.getActivity(c, 910720, settings,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(c, CHANNEL);
        return b.setSmallIcon(android.R.drawable.ic_popup_reminder).setContentTitle(title).setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(open)
                .setCategory(attention ? Notification.CATEGORY_ERROR : Notification.CATEGORY_STATUS)
                .setVisibility(Notification.VISIBILITY_PRIVATE).setOnlyAlertOnce(true)
                .setOngoing(!attention).setAutoCancel(attention).build();
    }
    static void show(Context c, String title, String text, boolean attention) {
        if (Prerequisites.notifications(c)) c.getSystemService(NotificationManager.class).notify(ID, build(c, title, text, attention));
    }
}
