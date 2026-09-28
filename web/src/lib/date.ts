/** Today's date (YYYY-MM-DD) in Pittsburgh time, so generated documents do not roll over at 8 PM ET. */
export const todayET = (d = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
