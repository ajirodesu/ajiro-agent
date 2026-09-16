/**
 * Relative date headers for the message long-press menu.
 *
 * Same day → `Today, {time}`; one day ago → `Yesterday, {time}`; same
 * year → `September 11, {time}`; previous year → `September 11 2025,
 * {time}`. Times render 12-hour (`2:10 PM`); invalid input falls back to
 * the raw value or "Unknown date".
 */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatTime(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const suffix = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${suffix}`;
}

/** Compact 12-hour clock time (`2:10 PM`) for an ISO timestamp. */
export function formatClockTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return formatTime(date);
}

export function formatMessageDate(  createdAt: string,
  nowMs: number = Date.now(),
): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return createdAt || "Unknown date";
  }
  const time = formatTime(date);
  const now = new Date(nowMs);
  const dayDiff = Math.round(
    (startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000),
  );
  if (dayDiff <= 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Yesterday, ${time}`;
  const monthDay = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${monthDay}, ${time}`;
  }
  return `${monthDay} ${date.getFullYear()}, ${time}`;
}
