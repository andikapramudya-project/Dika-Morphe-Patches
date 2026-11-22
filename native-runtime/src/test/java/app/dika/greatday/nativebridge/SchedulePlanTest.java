/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.greatday.nativebridge;

import java.time.Instant;
import java.util.TimeZone;

/** Fast host tests, independent of Android and the host's default time zone. */
public final class SchedulePlanTest {
    private static int checks;
    private static long at(String value) { return Instant.parse(value).toEpochMilli(); }
    private static void equal(Object actual, Object expected) {
        checks++; if (!expected.equals(actual)) throw new AssertionError(actual + " != " + expected);
    }
    public static void main(String[] args) {
        TimeZone original = TimeZone.getDefault();
        try {
            for (String zone : new String[]{"UTC", "Asia/Jakarta", "America/New_York", "Asia/Makassar"}) {
                TimeZone.setDefault(TimeZone.getTimeZone(zone));
                long sunday = at("2026-11-08T22:59:59Z"); // Monday 06:59:59 WITA
                equal(SchedulePlan.next(sunday, "07:00", 31), at("2026-11-08T23:00:00Z"));
                equal(SchedulePlan.next(sunday, "19:00", 31), at("2026-11-09T11:00:00Z"));
                equal(SchedulePlan.next(at("2026-11-13T11:00:00Z"), "07:00", 31), at("2026-11-15T23:00:00Z"));
                equal(SchedulePlan.next(at("2026-12-31T23:00:00Z"), "07:00", 127), at("2027-01-01T23:00:00Z"));
                equal(SchedulePlan.date(at("2026-11-08T16:00:00Z")), "2026-11-09");
                equal(SchedulePlan.key("account", "out", at("2026-11-09T11:00:00Z")),
                        SchedulePlan.key("account", "out", at("2026-11-09T12:00:00Z")));
                equal(SchedulePlan.isDue(sunday, sunday + 1), false);
                equal(SchedulePlan.isDue(sunday + 900000, sunday), true);
                equal(SchedulePlan.isDue(sunday + 900001, sunday), false);
            }
            for (String bad : new String[]{"7:00", "24:00", "19:60", "-1:00", ""}) {
                try { SchedulePlan.minute(bad); throw new AssertionError("Accepted " + bad); }
                catch (IllegalArgumentException expected) { checks++; }
            }
            for (int mask : new int[]{0, 128, -1}) {
                try { SchedulePlan.next(System.currentTimeMillis(), "07:00", mask); throw new AssertionError("Accepted day mask"); }
                catch (IllegalArgumentException expected) { checks++; }
            }
            equal(GreatDayOfflineHook.invokeGreatDayOfflineClockIn(-5.1, 119.4, System.currentTimeMillis()), GreatDayOfflineHook.Result.NOT_IMPLEMENTED);
            equal(GreatDayOfflineHook.invokeGreatDayOfflineClockOut(-5.1, 119.4, System.currentTimeMillis()), GreatDayOfflineHook.Result.NOT_IMPLEMENTED);
            System.out.println("PASS " + checks + " native schedule/time-zone/duplicate-key/dummy-hook checks");
        } finally { TimeZone.setDefault(original); }
    }
}
