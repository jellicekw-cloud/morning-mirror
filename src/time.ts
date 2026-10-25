// All times are New York time, no matter what the device's clock zone is set to.
export const TZ = "America/New_York";

export interface NyNow {
  date: string;        // 2026-10-26
  minutes: number;     // minutes since midnight
  seconds: number;
  isWeekday: boolean;
  clock: string;       // "4:42"
  ampm: string;        // "AM"
  dateLabel: string;   // "Monday, October 26"
}

export function nyNow(d = new Date()): NyNow {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;

  const hour = Number(p.hour);
  const minute = Number(p.minute);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(d);

  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: hour * 60 + minute,
    seconds: Number(p.second),
    isWeekday: !["Sat", "Sun"].includes(p.weekday),
    clock: `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")}`,
    ampm: hour < 12 ? "AM" : "PM",
    dateLabel,
  };
}

export function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** 300 → "5:00", "14:30" → "2:30" */
export function fmt12(t: string | number, withAmPm = false): string {
  const n = typeof t === "number" ? t : toMin(t);
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  const base = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`;
  return withAmPm ? `${base} ${h < 12 ? "AM" : "PM"}` : base;
}

/** "2026-11-14" → "Sat, Nov 14" */
export function prettyDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** ISO timestamp → "4:42 AM" in New York time */
export function timeOfIso(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}
