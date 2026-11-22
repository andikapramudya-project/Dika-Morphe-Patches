/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.greatday.nativebridge;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Reads the actual selected patch flags even in a process started by a boot/alarm broadcast. */
final class NativePolicy {
    private final String flags;
    NativePolicy(Context context) {
        String value = "";
        try (InputStream in = context.getAssets().open("public/dika/features.js")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[512]; int n;
            while ((n = in.read(buffer)) != -1) {
                out.write(buffer, 0, n);
                if (out.size() > 4096) throw new IllegalStateException("Invalid feature policy");
            }
            value = new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception ignored) { }
        flags = value;
    }
    private boolean flag(String name) {
        return java.util.regex.Pattern.compile("(?:\\{|,)" + name + ":true(?:,|\\})").matcher(flags).find();
    }
    boolean scheduler() { return flag("trial") && flag("nativeTrial") && flag("scheduler"); }
    boolean reminders() { return flag("trial") && flag("nativeTrial") && flag("reminders"); }
    boolean active() { return scheduler() || reminders(); }
}
