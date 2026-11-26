/** Returns the calendar date of `now` in `campusTimezone` as YYYY-MM-DD. */
export function generatedFor(now: Date, campusTimezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: campusTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}
