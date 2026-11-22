/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.greatday.nativebridge;

/** Integration seam only. There is deliberately no DAO, reflection or network call. */
public final class GreatDayOfflineHook {
    public enum Result { NOT_IMPLEMENTED }
    public enum Kind { CLOCK_IN, CLOCK_OUT }
    private GreatDayOfflineHook() {}

    public static Result invokeGreatDayOfflineClockIn(double lat, double lon, long timestamp) {
        return invokeGreatDayOfflineAttendance(Kind.CLOCK_IN, lat, lon, timestamp);
    }
    public static Result invokeGreatDayOfflineClockOut(double lat, double lon, long timestamp) {
        return invokeGreatDayOfflineAttendance(Kind.CLOCK_OUT, lat, lon, timestamp);
    }
    public static Result invokeGreatDayOfflineAttendance(Kind kind, double lat, double lon, long timestamp) {
        // TODO: Verify account, payload, original validation and exact DAO contract before replacing.
        // A future implementation must return the actual durable GreatDay record ID and preserve the send hold.
        return Result.NOT_IMPLEMENTED;
    }
}
