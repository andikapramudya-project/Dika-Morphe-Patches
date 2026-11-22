/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.greatday.nativebridge;

import android.content.Context;
import android.content.SharedPreferences;
import android.location.Location;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

/** A separate private store. Never reads or writes a GreatDay database. */
final class NativeStore {
    static final String PREFS = "dika_native_trial_v1";
    private final SharedPreferences prefs;
    private final NativePolicy policy;
    NativeStore(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); policy = new NativePolicy(context);
    }
    JSONObject config() { return parse(prefs.getString("config", "{}")); }
    String revision() { return config().optString("revision"); }
    boolean enabled() { return policy.active() && config().optBoolean("enabled", false); }
    long expected(String slot) { return prefs.getLong("next_" + slot, 0); }
    void expected(String slot, long at) { commit(prefs.edit().putLong("next_" + slot, at)); }

    JSONObject configure(JSONObject input, String identity) throws Exception {
        boolean enabled = input.getBoolean("enabled");
        if (enabled && !policy.active()) throw new IllegalArgumentException("Fitur jadwal native tidak dipilih");
        String in = input.getString("inTime"), out = input.getString("outTime");
        SchedulePlan.minute(in); SchedulePlan.minute(out);
        if (in.equals(out)) throw new IllegalArgumentException("Jam masuk dan pulang harus berbeda");
        JSONArray days = input.getJSONArray("days");
        int mask = 0;
        for (int i = 0; i < days.length(); i++) {
            Object value = days.get(i);
            if (!(value instanceof Number) || ((Number) value).doubleValue() != days.getInt(i))
                throw new IllegalArgumentException("Hari tidak valid");
            int d = days.getInt(i);
            if (d < 1 || d > 7) throw new IllegalArgumentException("Hari tidak valid");
            mask |= 1 << (d - 1);
        }
        if (mask == 0) throw new IllegalArgumentException("Pilih hari kerja");
        if (enabled && (identity == null || identity.isEmpty() || identity.length() > 1024))
            throw new IllegalArgumentException("Login GreatDay sebelum mengaktifkan");
        JSONObject result = new JSONObject().put("enabled", enabled).put("zone", SchedulePlan.ZONE)
                .put("inTime", in).put("outTime", out).put("days", days).put("daysMask", mask)
                .put("recordLocation", policy.scheduler() && input.optBoolean("recordLocation", true))
                .put("accountHash", hash(identity == null ? "" : identity))
                .put("revision", UUID.randomUUID().toString());
        commit(prefs.edit().putString("config", result.toString()).remove("next_in").remove("next_out"));
        return result;
    }

    void disable() {
        try {
            JSONObject c = config().put("enabled", false).put("revision", UUID.randomUUID().toString());
            commit(prefs.edit().putString("config", c.toString()).remove("next_in").remove("next_out"));
        } catch (JSONException e) { throw new IllegalStateException(e); }
    }

    JSONObject attempt(String key) { return parse(prefs.getString("attempt_" + key, "{}")); }
    boolean reserve(String key, String slot, long at, String revision) throws JSONException {
        if (prefs.contains("attempt_" + key)) return false;
        JSONObject record = new JSONObject().put("key", key).put("slot", slot).put("scheduledAt", at)
                .put("revision", revision).put("status", "running").put("startedAt", System.currentTimeMillis());
        // Durable intent precedes every location/storage effect. Do not prune reservations.
        commit(prefs.edit().putString("attempt_" + key, record.toString()));
        event(key, "running", "Alarm native diterima; menyiapkan lokasi.");
        return true;
    }

    boolean owns(String key, String revision) {
        JSONObject a = attempt(key);
        return enabled() && revision.equals(revision()) && revision.equals(a.optString("revision"))
                && "running".equals(a.optString("status"));
    }

    void finish(String key, String status, String message) {
        try {
            JSONObject a = attempt(key);
            if (!a.has("key")) return;
            a.put("status", status).put("finishedAt", System.currentTimeMillis());
            commit(prefs.edit().putString("attempt_" + key, a.toString()));
            event(key, status, message);
        } catch (JSONException e) { throw new IllegalStateException(e); }
    }

    void event(String key, String status, String message) {
        try {
            JSONArray old = new JSONArray(prefs.getString("history", "[]")), result = new JSONArray();
            for (int i = Math.max(0, old.length() - 49); i < old.length(); i++) result.put(old.get(i));
            // No account identifier or coordinates in exported diagnostics/history.
            result.put(new JSONObject().put("at", System.currentTimeMillis())
                    .put("slot", key.endsWith(":out") ? "out" : key.endsWith(":in") ? "in" : "system")
                    .put("status", status).put("message", message));
            commit(prefs.edit().putString("history", result.toString()));
        } catch (JSONException e) { throw new IllegalStateException(e); }
    }

    void saveDummy(String key, double lat, double lon, long timestamp, Location fix) throws JSONException {
        if (!Double.isFinite(lat) || !Double.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180
                || (lat == 0 && lon == 0)) throw new IllegalArgumentException("Koordinat tidak valid");
        JSONObject a = attempt(key);
        if (!"running".equals(a.optString("status"))) throw new IllegalStateException("Percobaan tidak aktif");
        JSONArray old = new JSONArray(prefs.getString("dummy_records", "[]")), result = new JSONArray();
        for (int i = Math.max(0, old.length() - 49); i < old.length(); i++) result.put(old.get(i));
        result.put(new JSONObject().put("id", UUID.randomUUID().toString()).put("key", key)
                .put("slot", a.getString("slot")).put("scheduledAt", a.getLong("scheduledAt"))
                .put("latitude", lat).put("longitude", lon).put("timestamp", timestamp)
                .put("fixTimestamp", fix.getTime()).put("accuracyMeters", fix.getAccuracy())
                .put("greatDayHook", "NOT_IMPLEMENTED").put("serverSendHeld", true));
        a.put("status", "dummy-saved").put("finishedAt", timestamp);
        // Record and terminal reservation are committed together.
        commit(prefs.edit().putString("dummy_records", result.toString()).putString("attempt_" + key, a.toString()));
        event(key, "dummy-saved", "Lokasi tersimpan sementara di patch. Hook GreatDay belum terhubung; tidak dikirim.");
    }

    JSONObject status(Context context) throws JSONException {
        JSONObject c = config();
        JSONObject publicConfig = new JSONObject().put("enabled", enabled())
                .put("zone", SchedulePlan.ZONE).put("inTime", c.optString("inTime", "07:00"))
                .put("outTime", c.optString("outTime", "19:00"))
                .put("days", c.optJSONArray("days") == null ? new JSONArray("[1,2,3,4,5]") : c.getJSONArray("days"));
        JSONObject today = new JSONObject();
        if (c.has("accountHash")) for (String slot : NativeScheduler.SLOTS) {
            JSONObject a = attempt(SchedulePlan.key(c.optString("accountHash"), slot, System.currentTimeMillis()));
            String state = a.optString("status", "waiting");
            if ("running".equals(state) && System.currentTimeMillis() - a.optLong("startedAt") > 90_000L) state = "interrupted";
            today.put(slot, state);
        }
        return new JSONObject().put("mode", "native-dummy-trial").put("config", publicConfig).put("today", today)
                .put("nextIn", expected("in")).put("nextOut", expected("out"))
                .put("permissions", Prerequisites.status(context))
                .put("history", new JSONArray(prefs.getString("history", "[]")))
                .put("dummyCount", new JSONArray(prefs.getString("dummy_records", "[]")).length())
                .put("greatDayHook", "NOT_IMPLEMENTED").put("serverSendHeld", true)
                .put("supportsNativeProcessRestart", true).put("greatDayColdStartSupported", false);
    }

    static String hash(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte b : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            return result.toString();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    private static JSONObject parse(String value) {
        try { return new JSONObject(value); }
        catch (JSONException e) { throw new IllegalStateException("Penyimpanan native tidak dapat dibaca", e); }
    }
    private static void commit(SharedPreferences.Editor edit) {
        if (!edit.commit()) throw new IllegalStateException("Penyimpanan native gagal");
    }
}
