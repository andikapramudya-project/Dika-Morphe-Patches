/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.greatday.nativebridge;

import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

public final class AttendanceForegroundService extends Service implements LocationListener {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private NativeStore store;
    private String key, revision;
    private LocationManager locations;
    private PowerManager.WakeLock wake;
    private boolean finished;
    private final Runnable timeout = () -> complete("needs-user", "Lokasi baru belum tersedia setelah 45 detik. Periksa GPS; belum ada catatan GreatDay.");

    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onCreate() { super.onCreate(); store = new NativeStore(this); }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        String incoming = intent.getStringExtra("key"), rev = intent.getStringExtra("revision");
        if (key != null) {
            if (!key.equals(incoming)) store.finish(incoming, "needs-user", "Uji lokasi lain masih berlangsung.");
            return START_NOT_STICKY;
        }
        key = incoming; revision = rev;
        try {
            if (key == null || revision == null || !store.owns(key, revision) || !new NativePolicy(this).scheduler()) { stopSelf(); return START_NOT_STICKY; }
            String problem = Prerequisites.locationProblem(this);
            if (problem != null) { complete("needs-user", problem); return START_NOT_STICKY; }
            android.app.Notification n = NativeNotifications.build(this, "Uji jadwal native", "Mengambil lokasi aktual. Pengiriman server ditahan.", false);
            if (Build.VERSION.SDK_INT >= 29) startForeground(NativeNotifications.ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NativeNotifications.ID, n);
            wake = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DikaGreatDay:LocationTrial");
            wake.acquire(60_000L);
            locations = getSystemService(LocationManager.class);
            Location cached = locations.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (acceptable(cached)) { onLocationChanged(cached); return START_NOT_STICKY; }
            handler.postDelayed(timeout, 45_000L);
            locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper());
        } catch (SecurityException e) {
            // Permissions may be revoked between the preflight and the actual platform call.
            complete("needs-user", "Izin lokasi berubah atau ditolak saat layanan dimulai. Periksa izin native.");
        } catch (Exception e) {
            complete("needs-user", "Pengambilan lokasi gagal. Periksa izin lokasi latar belakang dan notifikasi.");
        }
        return START_NOT_STICKY; // Alarm, not a forever-running keeper, owns the next execution.
    }

    static boolean acceptable(Location fix) {
        if (fix == null || !fix.hasAccuracy() || !Float.isFinite(fix.getAccuracy()) || fix.getAccuracy() < 0 || fix.getAccuracy() > 100f) return false;
        if (!Double.isFinite(fix.getLatitude()) || !Double.isFinite(fix.getLongitude())
                || Math.abs(fix.getLatitude()) > 90 || Math.abs(fix.getLongitude()) > 180
                || (fix.getLatitude() == 0 && fix.getLongitude() == 0)) return false;
        if (Build.VERSION.SDK_INT >= 31 ? fix.isMock() : fix.isFromMockProvider()) return false;
        long age = SystemClock.elapsedRealtimeNanos() - fix.getElapsedRealtimeNanos();
        return fix.getElapsedRealtimeNanos() > 0 && age >= 0 && age <= 120_000_000_000L;
    }

    @Override public void onLocationChanged(Location fix) {
        if (finished || !acceptable(fix)) return;
        try {
            if (!store.owns(key, revision)) { complete("cancelled", "Jadwal atau akun berubah; lokasi tidak disimpan."); return; }
            String problem = Prerequisites.locationProblem(this);
            if (problem != null) { complete("needs-user", problem); return; }
            long actualTimestamp = System.currentTimeMillis();
            simpanAbsenLokal(fix.getLatitude(), fix.getLongitude(), actualTimestamp, fix);
            GreatDayOfflineHook.Result result = "out".equals(store.attempt(key).optString("slot"))
                    ? GreatDayOfflineHook.invokeGreatDayOfflineClockOut(fix.getLatitude(), fix.getLongitude(), actualTimestamp)
                    : GreatDayOfflineHook.invokeGreatDayOfflineClockIn(fix.getLatitude(), fix.getLongitude(), actualTimestamp);
            if (result != GreatDayOfflineHook.Result.NOT_IMPLEMENTED) throw new IllegalStateException("Unexpected hook result");
            complete("dummy-saved", "Lokasi tersimpan sementara di patch. Hook GreatDay belum terhubung; tidak dikirim ke server.");
        } catch (Exception e) { complete("needs-user", "Penyimpanan sementara belum terkonfirmasi. Periksa status patch; tidak diulang otomatis."); }
    }

    /** Requested three-argument template, bound to the active native attempt. */
    public void simpanAbsenLokal(double lat, double lon, long timestamp) throws Exception {
        if (currentFix == null) throw new IllegalStateException("Lokasi tervalidasi belum tersedia");
        store.saveDummy(key, lat, lon, timestamp, currentFix);
    }
    private Location currentFix;
    private void simpanAbsenLokal(double lat, double lon, long timestamp, Location fix) throws Exception {
        currentFix = fix;
        try { simpanAbsenLokal(lat, lon, timestamp); } finally { currentFix = null; }
    }

    private void complete(String status, String message) {
        if (finished) return;
        finished = true;
        cleanup();
        try { if (key != null && !("dummy-saved".equals(status) && "dummy-saved".equals(store.attempt(key).optString("status")))) store.finish(key, status, message); }
        catch (Exception ignored) { /* Leave the reservation closed even when final status cannot be written. */ }
        stopForeground(STOP_FOREGROUND_DETACH);
        try { NativeNotifications.show(this, "dummy-saved".equals(status) ? "Uji lokasi selesai · hook belum terhubung" : "Uji jadwal perlu perhatian", message, true); }
        catch (Exception ignored) { }
        stopSelf();
    }
    private void cleanup() {
        handler.removeCallbacks(timeout);
        if (locations != null) { try { locations.removeUpdates(this); } catch (Exception ignored) { } }
        if (wake != null && wake.isHeld()) wake.release();
    }
    @Override public void onDestroy() {
        cleanup();
        if (!finished && key != null) {
            try { store.finish(key, "interrupted", "Layanan terputus; tidak diulang otomatis."); } catch (Exception ignored) { }
        }
        super.onDestroy();
    }
    @Override public void onProviderDisabled(String provider) { complete("needs-user", "GPS dimatikan saat uji. Aktifkan lokasi."); }
    @Override public void onProviderEnabled(String provider) { }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
}
