/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.greatday.nativebridge;

import android.app.Activity;
import android.app.Application;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebView;
import org.json.JSONObject;

/** Boots in a fresh app process; does not create a hidden Activity or keep WebView alive. */
public final class NativeInitProvider extends ContentProvider {
    @Override public boolean onCreate() {
        if (getContext().getApplicationContext() instanceof Application) {
            ((Application) getContext().getApplicationContext()).registerActivityLifecycleCallbacks(new BridgeLifecycle());
        }
        return true;
    }
    @Override public Cursor query(Uri uri, String[] p, String s, String[] a, String sort) { return null; }
    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }

    static final class BridgeLifecycle implements Application.ActivityLifecycleCallbacks {
        private final Handler main = new Handler(Looper.getMainLooper());
        private Activity activity;
        private WebView web;
        private WebMessagePort port;
        private long lastSeen;
        private String pageUrl;
        private final Runnable scan = new Runnable() {
            @Override public void run() {
                if (activity == null) return;
                try {
                    WebView candidate = find(activity.getWindow().getDecorView());
                    if (candidate != null && allowed(candidate.getUrl())) {
                        if (candidate != web || !candidate.getUrl().equals(pageUrl)
                                || System.currentTimeMillis() - lastSeen > 6000) connect(candidate);
                        if (port != null) port.postMessage(new WebMessage("{\"event\":\"ping\"}"));
                    } else close();
                } catch (Exception ignored) { close(); }
                main.postDelayed(this, 2000);
            }
        };
        static boolean allowed(String url) {
            if (url == null) return false;
            Uri uri = Uri.parse(url);
            // The fingerprinted Capacitor config has no remote server override.
            return ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))
                    && "localhost".equals(uri.getEncodedAuthority());
        }
        private void connect(WebView candidate) {
            close(); web = candidate; pageUrl = candidate.getUrl(); lastSeen = System.currentTimeMillis();
            WebMessagePort[] pair = candidate.createWebMessageChannel();
            port = pair[0];
            final WebMessagePort channel = port;
            channel.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
                @Override public void onMessage(WebMessagePort sender, WebMessage message) {
                    if (channel != port || activity == null || web == null || !allowed(web.getUrl())
                            || !pageUrl.equals(web.getUrl()) || message.getData() == null || message.getData().length() > 16384) return;
                    long id = 0;
                    try {
                        JSONObject request = new JSONObject(message.getData());
                        lastSeen = System.currentTimeMillis();
                        if ("pong".equals(request.optString("method"))) return;
                        id = request.getLong("id");
                        String method = request.getString("method");
                        NativeStore store = new NativeStore(activity);
                        switch (method) {
                            case "status": break;
                            case "bindAccount": {
                                String identity = request.optString("identity", "");
                                if (identity.length() > 1024) throw new IllegalArgumentException("Akun tidak valid");
                                if (store.enabled() && !NativeStore.hash(identity).equals(store.config().optString("accountHash"))) {
                                    store.disable(); NativeScheduler.rearm(activity);
                                    activity.stopService(new android.content.Intent(activity, AttendanceForegroundService.class));
                                }
                                break;
                            }
                            case "configure": {
                                JSONObject config = request.getJSONObject("config");
                                // Do not accept enabled schedules that Android cannot deliver or show to the user.
                                if (config.getBoolean("enabled") && (!Prerequisites.exact(activity) || !Prerequisites.notifications(activity)))
                                    throw new IllegalStateException("Izinkan Alarm & pengingat dan notifikasi, lalu simpan ulang.");
                                store.configure(config, request.optString("identity", ""));
                                activity.stopService(new android.content.Intent(activity, AttendanceForegroundService.class));
                                NativeScheduler.rearm(activity);
                                break;
                            }
                            case "permissions":
                                activity.startActivity(new android.content.Intent(activity, NativePermissionActivity.class)); break;
                            default: throw new IllegalArgumentException("Perintah native tidak dikenal");
                        }
                        channel.postMessage(new WebMessage(new JSONObject().put("id", id).put("result", store.status(activity)).toString()));
                    } catch (Exception e) {
                        try { channel.postMessage(new WebMessage(new JSONObject().put("id", id)
                                .put("error", e.getMessage() == null ? "Operasi native gagal" : e.getMessage()).toString())); }
                        catch (Exception ignored) { }
                    }
                }
            }, main);
            Uri uri = Uri.parse(pageUrl);
            candidate.postWebMessage(new WebMessage("dika-native-attendance-v1", new WebMessagePort[]{pair[1]}),
                    Uri.parse(uri.getScheme() + "://localhost"));
        }
        private static WebView find(View view) {
            if (view instanceof WebView) return (WebView) view;
            if (view instanceof ViewGroup) {
                ViewGroup group = (ViewGroup) view;
                for (int i = 0; i < group.getChildCount(); i++) { WebView found = find(group.getChildAt(i)); if (found != null) return found; }
            }
            return null;
        }
        private void close() {
            if (port != null) { try { port.close(); } catch (Exception ignored) { } }
            port = null; web = null; pageUrl = null;
        }
        @Override public void onActivityResumed(Activity a) {
            if (a instanceof NativePermissionActivity) return;
            activity = a;
            try { NativeScheduler.rearm(a); } catch (Exception ignored) { }
            main.removeCallbacks(scan); main.post(scan);
        }
        @Override public void onActivityPaused(Activity a) {
            if (activity == a) { main.removeCallbacks(scan); activity = null; close(); }
        }
        @Override public void onActivityDestroyed(Activity a) { onActivityPaused(a); }
        @Override public void onActivityCreated(Activity a, Bundle b) { }
        @Override public void onActivityStarted(Activity a) { }
        @Override public void onActivityStopped(Activity a) { }
        @Override public void onActivitySaveInstanceState(Activity a, Bundle b) { }
    }
}
