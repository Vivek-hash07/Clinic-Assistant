export const DOCTORS = [
  "Dr. Priya Shah",
  "Dr. James Okonkwo",
  "Dr. Elena Vasquez",
] as const;

export const SLOT_MINUTES = 30;
export const OPEN_MINUTES = 9 * 60;
export const CLOSE_MINUTES = 16 * 60 + 30;

export function formatSlot(date: Date): string {
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${label} UTC`;
}
