// Talks to the mirror's Supabase edge functions.
// The device key is never in the code: the tablet opens the page once with
// ?key=YOUR_DEVICE_KEY, it's saved on that device, and removed from the address bar.

export type Kind = "sun" | "moon" | "cloud" | "rain" | "snow" | "storm" | "fog";

export interface Hour {
  temp: number;
  rain: number;
  kind: Kind;
  label: string;
}

export interface Day extends Hour {
  date: string;
  name: string;
  hi: number;
  lo: number;
}

export interface HourSlot extends Hour {
  time: string;   // "2026-10-25T19:00" (New York time)
}

export type DepartureStatus = "on_time" | "close" | "late";

export interface Departure {
  local_date: string;
  left_at: string;
  left_min: number;
  status: DepartureStatus;
}

export interface DepartureStats {
  count: number;
  onTime: number;
  close: number;
  late: number;
  avgMin: number | null;
}

export interface MirrorData {
  now: { date: string; weekday: string; minutes: number };
  photos?: string[];
  // undefined = older server code; null = table not created yet
  departures?: null | {
    today: Departure | null;
    week: DepartureStats;
    last4Weeks: { count: number; onTime: number; avgMin: number | null };
  };
  isWorkday: boolean;
  schedule: {
    alarm: string;
    leaveIdeal: string;
    leaveLatest: string;
    arriveGoal: string;
    workStart: string;
    workEnd: string;
  };
  meds: { time: string; taken: boolean; takenAt: string | null; source: string | null };
  refill: null | { lastRefill: string; runOutDate: string; daysLeft: number; due: boolean };
  weather: null | {
    now: { temp: number; kind: Kind; label: string };
    driveIn: Hour | null;
    driveHome: Hour | null;
    today?: { sunrise: string | null; sunset: string | null; uv: number | null };
    tomorrow?: { date: string; driveIn: Hour | null; driveHome: Hour | null };
    hourly?: HourSlot[];
    days: Day[];
    fetchedAt: string;
  };
  commute: null | {
    minutes: number;
    normalMinutes: number;
    delayMinutes: number;
    miles: number;
    status: "normal" | "slower" | "heavy";
    fetchedAt: string;
    leaveBy: string;
    leaveLatest: string;
    movedEarlier: boolean;
  };
}

// The project URL is public (it's not a secret), so it's built in as a fallback.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://zmtqlcbneupvjifdqrev.supabase.co";
const BASE = `${SUPABASE_URL.replace(/\/+$/, "").replace(/\/rest\/v1$/, "")}/functions/v1`;
const STORAGE_KEY = "mirror-device-key";

export function loadDeviceKey(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("key");
  if (fromUrl) {
    try {
      localStorage.setItem(STORAGE_KEY, fromUrl);
    } catch {
      /* storage blocked: still works for this session */
    }
    url.searchParams.delete("key");
    window.history.replaceState(null, "", url.toString());
    return fromUrl;
  }
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export class KeyRejectedError extends Error {
  constructor() {
    super("device key rejected");
  }
}

export async function fetchMirror(key: string): Promise<MirrorData> {
  let r: Response;
  try {
    r = await fetch(`${BASE}/mirror-data`, {
      headers: { "x-mirror-key": key },
      cache: "no-store",
    });
  } catch {
    throw new Error("No connection to Supabase (network or Wi-Fi)");
  }
  if (r.status === 401) throw new KeyRejectedError();
  if (!r.ok) {
    let detail = "";
    try {
      detail = (await r.text()).slice(0, 120);
    } catch {
      /* ignore */
    }
    throw new Error(`mirror-data error ${r.status}${detail ? `: ${detail}` : ""}`);
  }
  return r.json();
}

export type MirrorAction = "took" | "undo" | "refilled" | "go" | "go_undo";

export async function medsAction(key: string, action: MirrorAction, at?: string) {
  const r = await fetch(`${BASE}/mirror-meds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mirror-key": key },
    body: JSON.stringify(at ? { action, at } : { action }),
  });
  if (!r.ok) throw new Error(`mirror-meds ${r.status}`);
  return r.json();
}
