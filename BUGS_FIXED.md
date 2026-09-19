# BUGS_FIXED.md

| Source File / Subsystem | Issue Identified | Native Fix Applied |
|---|---|---|
| `tsconfig.json` | Stale reference to non-existent `device-automation` module. | Cleaned up references in native port build setup. |
| Background Service / Android 14+ | Unhandled foreground service type constraints on Android 14+. | Configured `foregroundServiceType="dataSync"` in Manifest and service implementation. |
| Exact Alarms / Android 12+ | Unhandled `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` runtime permission state leading to crash on schedule trigger. | Added explicit fallback to `AlarmManager.setAndAllowWhileIdle` and runtime permission checking. |
| Unhandled Coroutine Exception Streaming | Unhandled LLM SSE connection failures crashing app runtime. | Enclosed streaming channels in structured coroutine exception handlers (`CoroutineExceptionHandler`). |
