/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.greatday.nativebridge;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Permission prompts are user-initiated from a visible screen, never from a receiver. */
public final class NativePermissionActivity extends Activity {
    @Override public void onCreate(Bundle b) { super.onCreate(b); render(); }
    @Override public void onResume() {
        super.onResume();
        try { NativeScheduler.rearm(this); } catch (Exception ignored) { }
        render();
    }
    private void render() {
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density); content.setPadding(pad, pad, pad, pad);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.addView(content); setContentView(scroll);
        TextView title = new TextView(this); title.setText("Izin uji jadwal native"); title.setTextSize(23); content.addView(title);
        TextView info = new TextView(this); info.setTextSize(15);
        String problem;
        try { problem = Prerequisites.locationProblem(this); } catch (Exception e) { problem = "Periksa izin aplikasi."; }
        info.setText("Hanya menyimpan lokasi sementara di patch. Hook GreatDay belum terhubung. Pengiriman server ditahan.\n\n"
                + "Alarm & pengingat: " + (Prerequisites.exact(this) ? "diizinkan" : "belum diizinkan")
                + "\nNotifikasi: " + (Prerequisites.notifications(this) ? "diizinkan" : "belum diizinkan")
                + "\nLokasi: " + (problem == null ? "siap untuk uji" : problem)
                + "\n\nDi Poco, aktifkan Autostart dan Battery saver: No restrictions untuk GreatDay. Setelah Force stop, buka GreatDay kembali.");
        content.addView(info);
        button(content, "Izinkan lokasi presisi", v -> requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, 710));
        button(content, "Lokasi sepanjang waktu / info aplikasi", v -> open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))));
        button(content, "Alarm & pengingat", v -> {
            if (Build.VERSION.SDK_INT >= 31) open(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName())));
        });
        button(content, "Izinkan notifikasi", v -> {
            if (Build.VERSION.SDK_INT >= 33 && !Prerequisites.granted(this, Manifest.permission.POST_NOTIFICATIONS))
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 711);
            else open(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
        });
        button(content, "Aktifkan GPS / lokasi", v -> open(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)));
        button(content, "Tanggal dan waktu otomatis", v -> open(new Intent(Settings.ACTION_DATE_SETTINGS)));
        button(content, "Nonaktifkan jadwal native", v -> {
            try { new NativeStore(this).disable(); NativeScheduler.rearm(this); stopService(new Intent(this, AttendanceForegroundService.class)); render(); }
            catch (Exception e) { info.setText("Jadwal belum dapat dinonaktifkan. Buka panel Jadwal."); }
        });
        button(content, "Kembali", v -> finish());
    }
    private void open(Intent intent) {
        try { startActivity(intent); } catch (Exception ignored) { }
    }
    private void button(LinearLayout layout, String label, View.OnClickListener listener) {
        Button b = new Button(this); b.setText(label); b.setOnClickListener(listener); layout.addView(b);
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] result) {
        super.onRequestPermissionsResult(request, permissions, result); render();
    }
}
