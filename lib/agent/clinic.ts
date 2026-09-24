export const DOCTORS = [
  "Dr. Priya Shah",
  "Dr. James Okonkwo",
  "Dr. Elena Vasquez",
] as const;

export type DoctorProfile = {
  name: (typeof DOCTORS)[number];
  specialty: string;
  focus: string;
  about: string;
};

export const DOCTOR_PROFILES: DoctorProfile[] = [
  {
    name: "Dr. Priya Shah",
    specialty: "Family medicine",
    focus: "Annual physicals, headaches, and ongoing primary care",
    about:
      "Weekday visits for checkups and new concerns. A typical visit reason on her schedule is an annual physical.",
  },
  {
    name: "Dr. James Okonkwo",
    specialty: "General practice",
    focus: "Joint follow-ups, vaccinations, and return visits",
    about:
      "Follow-up and vaccination visits, including knee appointments already on the clinic schedule.",
  },
  {
    name: "Dr. Elena Vasquez",
    specialty: "General practice",
    focus: "Same-week visits for rashes, coughs, and new symptoms",
    about:
      "Shorter-notice visits for skin checks and other new symptoms during weekday clinic hours.",
  },
];

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
