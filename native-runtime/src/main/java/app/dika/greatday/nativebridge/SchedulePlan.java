/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.greatday.nativebridge;

import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;

/** Android-free scheduling rules, also exercised by the host JVM tests. */
public final class SchedulePlan {
    public static final String ZONE = "Asia/Makassar";
    public static final long GRACE_MS = 15 * 60_000L;
    private SchedulePlan() {}

    public static int minute(String time) {
        if (time == null || !time.matches("([01][0-9]|2[0-3]):[0-5][0-9]"))
            throw new IllegalArgumentException("Jam tidak valid");
        return Integer.parseInt(time.substring(0, 2)) * 60 + Integer.parseInt(time.substring(3));
    }

    public static long next(long now, String time, int daysMask) {
        int minute = minute(time);
        if ((daysMask & 127) == 0 || (daysMask & ~127) != 0)
            throw new IllegalArgumentException("Pilih hari kerja");
        Calendar date = Calendar.getInstance(TimeZone.getTimeZone(ZONE), Locale.ROOT);
        date.setTimeInMillis(now);
        date.set(Calendar.HOUR_OF_DAY, minute / 60);
        date.set(Calendar.MINUTE, minute % 60);
        date.set(Calendar.SECOND, 0);
        date.set(Calendar.MILLISECOND, 0);
        for (int i = 0; i < 8; i++, date.add(Calendar.DAY_OF_MONTH, 1)) {
            int isoDay = (date.get(Calendar.DAY_OF_WEEK) + 5) % 7;
            if ((daysMask & (1 << isoDay)) != 0 && date.getTimeInMillis() > now)
                return date.getTimeInMillis();
        }
        throw new IllegalStateException("Jadwal tidak ditemukan");
    }

    public static String date(long at) {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone(ZONE), Locale.ROOT);
        c.setTimeInMillis(at);
        return String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR),
                c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    public static boolean isDue(long now, long scheduledAt) {
        return scheduledAt > 0 && now >= scheduledAt && now - scheduledAt <= GRACE_MS;
    }

    public static String key(String accountHash, String slot, long scheduledAt) {
        if (!"in".equals(slot) && !"out".equals(slot)) throw new IllegalArgumentException("Jenis absen tidak valid");
        // Changing the hour or restarting must never reopen the same daily slot.
        return accountHash + ":" + date(scheduledAt) + ":" + slot;
    }
}
