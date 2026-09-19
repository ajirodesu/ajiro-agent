import { Platform } from "react-native";

import type { Repositories } from "@/core/db/repositories/types";

export const SCHEDULER_ALARM_ACTION =
  "expo.modules.scheduleralarm.SCHEDULER_ALARM";

/**
 * Re-arms the native Android alarms so they match the enabled schedules stored
 * in the database. A no-op on every other platform (iOS uses calendar
 * notifications instead, dispatched from `onSchedulesChanged`).
 */
export async function syncScheduleAlarms(
  repositories: Repositories,
): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  const { cancelAllScheduleAlarms, setScheduleAlarm } = await import(
    "scheduler-alarm"
  );

  try {
    // Read the desired state BEFORE touching alarms: the cancel-then-set
    // window is the only moment zero alarms exist, so keep DB I/O out of
    // it to shrink the kill-between-calls hole.
    const settings = await repositories.configRepository.getSettings();

    if (!settings.schedulingEnabled) {
      await cancelAllScheduleAlarms();
      return;
    }

    const schedules = await repositories.scheduleRepository.listEnabled();
    const now = Date.now();

    await cancelAllScheduleAlarms();

    for (const schedule of schedules) {
      if (!schedule.nextRunAt) {
        continue;
      }

      const triggerAtMs = new Date(schedule.nextRunAt).getTime();

      if (!Number.isFinite(triggerAtMs)) {
        continue;
      }

      // Past-due alarms are set, not dropped: a past trigger fires
      // immediately and the engine tick then applies the grace/skip
      // policy with proper accounting. Dropping would strand the
      // schedule until the next foreground sync.
      await setScheduleAlarm(Math.max(triggerAtMs, now), schedule.id);
    }
  } catch (error) {
    console.error("[scheduler] Failed to sync alarms:", error);
  }
}
