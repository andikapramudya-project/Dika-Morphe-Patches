/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.greatday.nativebridge;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;
import android.Manifest;
import android.app.AlarmManager;
import android.app.Application;
import android.app.NotificationManager;
import android.content.Intent;
import android.location.Location;
import android.location.LocationManager;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.shadows.ShadowAlarmManager;
import java.time.Duration;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 36)
public final class NativeRuntimeTest {
    private Application app;
    private NativeStore store;
    private AlarmManager alarms;
    @Before public void setUp() {
        app = RuntimeEnvironment.getApplication();
        app.getSharedPreferences(NativeStore.PREFS, 0).edit().clear().commit();
        store = new NativeStore(app); alarms = app.getSystemService(AlarmManager.class);
        ShadowAlarmManager.setCanScheduleExactAlarms(true);
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION, Manifest.permission.POST_NOTIFICATIONS);
        shadowOf(app.getSystemService(LocationManager.class)).setProviderEnabled(LocationManager.GPS_PROVIDER, true);
        Settings.Global.putInt(app.getContentResolver(), Settings.Global.AUTO_TIME, 1);
    }
    private JSONObject config() throws Exception {
        return new JSONObject().put("enabled", true).put("inTime", "07:00").put("outTime", "19:00")
                .put("days", new JSONArray("[1,2,3,4,5,6,7]"));
    }
    private Intent due(String slot) throws Exception {
        store.configure(config(), "synthetic-account");
        long at = System.currentTimeMillis() - 1000;
        store.expected(slot, at);
        return new Intent(app, AttendanceAlarmReceiver.class).setAction(NativeScheduler.ACTION + "." + slot)
                .putExtra("slot", slot).putExtra("scheduledAt", at).putExtra("revision", store.revision());
    }
    private String key(Intent intent) throws Exception {
        return SchedulePlan.key(store.config().getString("accountHash"), intent.getStringExtra("slot"), intent.getLongExtra("scheduledAt", 0));
    }
    private Location fix() {
        Location fix = new Location(LocationManager.GPS_PROVIDER); fix.setLatitude(-5.1); fix.setLongitude(119.4);
        fix.setAccuracy(12); fix.setTime(System.currentTimeMillis());
        fix.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos()); return fix;
    }
    @Test public void exactlyTwoOneShotWakeupAlarmsSurviveRepeatedRearm() throws Exception {
        store.configure(config(), "synthetic-account"); NativeScheduler.rearm(app); NativeScheduler.rearm(app);
        assertEquals(2, shadowOf(alarms).getScheduledAlarms().size());
        for (ShadowAlarmManager.ScheduledAlarm alarm : shadowOf(alarms).getScheduledAlarms()) {
            assertEquals(AlarmManager.RTC_WAKEUP, alarm.type); assertEquals(0, alarm.interval);
            assertEquals(0, alarm.getWindowLengthMs()); assertTrue(alarm.isAllowWhileIdle());
            Intent saved = shadowOf(alarm.operation).getSavedIntent();
            assertEquals(AttendanceAlarmReceiver.class.getName(), saved.getComponent().getClassName());
            assertEquals(store.expected(saved.getStringExtra("slot")), saved.getLongExtra("scheduledAt", 0));
        }
    }
    @Test public void missingExactPermissionDoesNotSilentlyUseInexactAlarm() throws Exception {
        store.configure(config(), "account"); ShadowAlarmManager.setCanScheduleExactAlarms(false); NativeScheduler.rearm(app);
        assertTrue(shadowOf(alarms).getScheduledAlarms().isEmpty()); assertEquals(0, store.expected("in"));
        assertTrue(store.status(app).toString().contains("exact-permission-required"));
    }
    @Test public void bootRestoresAlarmsWithoutLaunchingLocationService() throws Exception {
        store.configure(config(), "account");
        new BootReceiver().onReceive(app, new Intent(Intent.ACTION_BOOT_COMPLETED));
        assertEquals(2, shadowOf(alarms).getScheduledAlarms().size()); assertNull(shadowOf(app).getNextStartedService());
    }
    @Test public void disabledConfigurationCancelsBothAlarms() throws Exception {
        store.configure(config(), "account"); NativeScheduler.rearm(app); store.disable(); NativeScheduler.rearm(app);
        assertTrue(shadowOf(alarms).getScheduledAlarms().isEmpty());
    }
    @Test public void resumeRearmPreservesAnUndeliveredDueAlarm() throws Exception {
        Intent intent = due("in"); long at = intent.getLongExtra("scheduledAt", 0);
        NativeScheduler.rearm(app); assertEquals(at, store.expected("in"));
        new AttendanceAlarmReceiver().onReceive(app, intent);
        assertNotNull(shadowOf(app).getNextStartedService()); assertTrue(store.expected("in") > System.currentTimeMillis());
    }
    @Test public void receiverReservesBeforeStartingServiceAndRejectsRedelivery() throws Exception {
        Intent intent = due("in"); String key = key(intent);
        new AttendanceAlarmReceiver().onReceive(app, intent);
        Intent started = shadowOf(app).getNextStartedService(); assertNotNull(started);
        assertEquals("running", store.attempt(key).getString("status"));
        assertEquals(key, started.getStringExtra("key"));
        new AttendanceAlarmReceiver().onReceive(app, intent); assertNull(shadowOf(app).getNextStartedService());
    }
    @Test public void gpsDisabledProducesWarningWithoutStartingService() throws Exception {
        Intent intent = due("out");
        shadowOf(app.getSystemService(LocationManager.class)).setProviderEnabled(LocationManager.GPS_PROVIDER, false);
        new AttendanceAlarmReceiver().onReceive(app, intent);
        assertNull(shadowOf(app).getNextStartedService()); assertEquals("needs-user", store.attempt(key(intent)).getString("status"));
        assertNotNull(shadowOf(app.getSystemService(NotificationManager.class)).getNotification(NativeNotifications.ID));
        assertEquals(0, store.status(app).getInt("dummyCount"));
    }
    @Test public void backgroundLocationDeniedDoesNotLaunchLocationService() throws Exception {
        Intent intent = due("in"); shadowOf(app).denyPermissions(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
        new AttendanceAlarmReceiver().onReceive(app, intent);
        assertNull(shadowOf(app).getNextStartedService()); assertEquals("needs-user", store.attempt(key(intent)).getString("status"));
    }
    @Test public void notificationPermissionDeniedDoesNotCollectLocationSilently() throws Exception {
        Intent intent = due("in"); shadowOf(app).denyPermissions(Manifest.permission.POST_NOTIFICATIONS);
        new AttendanceAlarmReceiver().onReceive(app, intent);
        assertNull(shadowOf(app).getNextStartedService()); assertEquals(0, store.status(app).getInt("dummyCount"));
    }
    @Test public void blockedNotificationChannelPreventsSilentLocationCollection() throws Exception {
        Intent intent = due("in");
        app.getSystemService(NotificationManager.class).createNotificationChannel(new android.app.NotificationChannel(
                NativeNotifications.CHANNEL, "Native trial", NotificationManager.IMPORTANCE_NONE));
        new AttendanceAlarmReceiver().onReceive(app, intent);
        assertNull(shadowOf(app).getNextStartedService()); assertEquals(0, store.status(app).getInt("dummyCount"));
    }
    @Test public void oldConfigurationAndEarlyBroadcastCannotRecord() throws Exception {
        Intent stale = due("in"); store.configure(config(), "new-account");
        new AttendanceAlarmReceiver().onReceive(app, stale); assertNull(shadowOf(app).getNextStartedService());
        Intent early = due("out"); early.putExtra("scheduledAt", System.currentTimeMillis() + 60000);
        store.expected("out", early.getLongExtra("scheduledAt", 0));
        new AttendanceAlarmReceiver().onReceive(app, early); assertNull(shadowOf(app).getNextStartedService());
        assertEquals(0, store.status(app).getInt("dummyCount"));
    }
    @Test public void changingTheHourCannotReopenAReservedDailySlot() throws Exception {
        Intent intent = due("in"); String key = key(intent); store.reserve(key, "in", intent.getLongExtra("scheduledAt", 0), store.revision());
        store.configure(config().put("inTime", "08:00"), "synthetic-account");
        assertFalse(store.reserve(key, "in", System.currentTimeMillis(), store.revision()));
    }
    @Test public void freshGpsSavesOnlyPrivateDummyAndStopsService() throws Exception {
        Intent intent = due("in"); new AttendanceAlarmReceiver().onReceive(app, intent);
        Intent started = shadowOf(app).getNextStartedService(); assertNotNull(started);
        ServiceController<AttendanceForegroundService> control = Robolectric.buildService(AttendanceForegroundService.class).create();
        control.get().onStartCommand(started, 0, 1); control.get().onLocationChanged(fix());
        assertEquals(1, store.status(app).getInt("dummyCount")); assertEquals("dummy-saved", store.attempt(key(intent)).getString("status"));
        assertTrue(shadowOf(control.get()).isStoppedBySelf());
        String exported = store.status(app).toString(); assertFalse(exported.contains("latitude")); assertFalse(exported.contains("synthetic-account"));
        assertEquals("NOT_IMPLEMENTED", store.status(app).getString("greatDayHook"));
        control.destroy();
    }
    @Test public void locationTimeoutClosesAttemptAndLateFixCannotSave() throws Exception {
        Intent intent = due("in"); new AttendanceAlarmReceiver().onReceive(app, intent);
        ServiceController<AttendanceForegroundService> control = Robolectric.buildService(AttendanceForegroundService.class).create();
        control.get().onStartCommand(shadowOf(app).getNextStartedService(), 0, 1);
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(46)); control.get().onLocationChanged(fix());
        assertEquals("needs-user", store.attempt(key(intent)).getString("status")); assertEquals(0, store.status(app).getInt("dummyCount")); control.destroy();
    }
    @Test public void changedAccountWhileFetchingCannotPersistTheFix() throws Exception {
        Intent intent = due("out"); new AttendanceAlarmReceiver().onReceive(app, intent);
        String originalKey = key(intent);
        ServiceController<AttendanceForegroundService> control = Robolectric.buildService(AttendanceForegroundService.class).create();
        control.get().onStartCommand(shadowOf(app).getNextStartedService(), 0, 1);
        store.configure(config(), "another-account"); control.get().onLocationChanged(fix());
        assertEquals(0, store.status(app).getInt("dummyCount")); assertEquals("cancelled", store.attempt(originalKey).getString("status")); control.destroy();
    }
    @Test public void staleInaccurateAndMockFixesAreRejected() {
        Location fix = fix(); assertTrue(AttendanceForegroundService.acceptable(fix));
        fix.setAccuracy(101); assertFalse(AttendanceForegroundService.acceptable(fix)); fix.setAccuracy(10);
        fix.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos() - 121_000_000_000L); assertFalse(AttendanceForegroundService.acceptable(fix));
        fix.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos()); fix.setMock(true); assertFalse(AttendanceForegroundService.acceptable(fix));
    }
    @Test public void bridgeOriginIsLimitedToLocalCapacitorOrigin() {
        assertTrue(NativeInitProvider.BridgeLifecycle.allowed("https://localhost/hr/attendance"));
        assertFalse(NativeInitProvider.BridgeLifecycle.allowed("https://localhost.evil.test/"));
        assertFalse(NativeInitProvider.BridgeLifecycle.allowed("https://user@localhost/"));
        assertFalse(NativeInitProvider.BridgeLifecycle.allowed("file:///android_asset/index.html"));
    }
}
