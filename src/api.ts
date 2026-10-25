// Talks to the mirror's Supabase edge functions.
// The device key is never in the code: the tablet opens the page once with
// ?key=YOUR_DEVICE_KEY, it's saved on that device, and removed from the address bar.

export type Kind = "sun" | "cloud" | "rain" | "snow" | "storm" | "fog";

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

export interface MirrorData {
  now: { date: string; weekday: string; minutes: number };
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

export async function fetchMirror(key: string): Promise<MirrorData> {
  const r = await fetch(`${BASE}/mirror-data`, {
    headers: { "x-mirror-key": key },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`mirror-data ${r.status}`);
  return r.json();
}

export async function medsAction(key: string, action: "took" | "undo" | "refilled") {
  const r = await fetch(`${BASE}/mirror-meds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mirror-key": key },
    body: JSON.stringify({ action }),
  });
  if (!r.ok) throw new Error(`mirror-meds ${r.status}`);
  return r.json();
}
