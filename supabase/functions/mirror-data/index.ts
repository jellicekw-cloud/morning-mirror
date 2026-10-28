// ============================================================
// mirror-data
// Everything the Morning Mirror screen shows: weather, commute,
// leave-by time, today's meds status, and refill status.
// Called by the tablet every few minutes with x-mirror-key = MIRROR_DEVICE_KEY.
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const LAT = 33.749;   // Atlanta (weather only; a few miles doesn't matter)
const LNG = -84.388;
const GOOGLE_DAILY_MAX = 50;           // hard cap on Google calls per day
const WEATHER_TTL_MIN = 15;
const COMMUTE_TTL_MIN = 4;
const COMMUTE_WINDOW_START = 4 * 60;        // 4:00 AM
const COMMUTE_WINDOW_END = 5 * 60 + 30;     // 5:30 AM
const PHOTO_BUCKET = "mirror-photos";
const PHOTOS_TTL_MIN = 30;                  // new uploads show up within 30 min
const PHOTO_LINK_HOURS = 2;                 // private links stay valid 2 hours

const DEVICE_KEY = Deno.env.get("MIRROR_DEVICE_KEY") ?? "";
const GOOGLE_KEY = Deno.env.get("GOOGLE_MAPS_KEY") ?? "";
const HOME_ADDRESS = Deno.env.get("HOME_ADDRESS") ?? "";
const WORK_ADDRESS = Deno.env.get("WORK_ADDRESS") ?? "";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-mirror-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ---------- time helpers (always New York time) ----------
function localNow(tz: string, d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday,
    isWeekday: !["Sat", "Sun"].includes(p.weekday),
    minutes: hour * 60 + minute,
  };
}

function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function fromMin(n: number) {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  const a = from.split("-").map(Number);
  const b = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000,
  );
}

function shortDay(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

// ---------- weather codes → icon kind + label ----------
function describe(code: number) {
  if (code === 0) return { kind: "sun", label: "Clear" };
  if (code === 1) return { kind: "sun", label: "Mostly clear" };
  if (code === 2) return { kind: "cloud", label: "Partly cloudy" };
  if (code === 3) return { kind: "cloud", label: "Cloudy" };
  if (code === 45 || code === 48) return { kind: "fog", label: "Foggy" };
  if (code >= 51 && code <= 57) return { kind: "rain", label: "Drizzle" };
  if (code >= 61 && code <= 67) return { kind: "rain", label: "Rain" };
  if (code >= 71 && code <= 77) return { kind: "snow", label: "Snow" };
  if (code >= 80 && code <= 82) return { kind: "rain", label: "Showers" };
  if (code >= 85 && code <= 86) return { kind: "snow", label: "Snow showers" };
  if (code >= 95) return { kind: "storm", label: "Thunderstorms" };
  return { kind: "cloud", label: "Cloudy" };
}

// ---------- cache: fresh if young enough, stale copy if a fetch fails ----------
async function cached<T>(
  key: string,
  ttlMin: number,
  fetcher: () => Promise<T | null>,
): Promise<T | null> {
  const { data } = await db
    .from("mirror_cache")
    .select("data, fetched_at")
    .eq("key", key)
    .maybeSingle();

  if (data && Date.now() - new Date(data.fetched_at).getTime() < ttlMin * 60000) {
    return data.data as T;
  }

  const fresh = await fetcher();
  if (fresh !== null) {
    await db.from("mirror_cache").upsert({
      key,
      data: fresh,
      fetched_at: new Date().toISOString(),
    });
    return fresh;
  }
  return (data?.data as T) ?? null;
}

// ---------- weather (Open-Meteo, free, no key) ----------
async function getWeather(today: string, tz: string, workEnd: string) {
  const params = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LNG),
    current: "temperature_2m,weather_code",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max",
    temperature_unit: "fahrenheit",
    timezone: tz,
    forecast_days: "7",
  });

  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!r.ok) {
    console.error("open-meteo", r.status, await r.text());
    return null;
  }
  const w = await r.json();

  const hourOf = (i: number) => ({
    temp: Math.round(w.hourly.temperature_2m[i]),
    rain: w.hourly.precipitation_probability[i] ?? 0,
    ...describe(w.hourly.weather_code[i]),
  });

  const hourAt = (date: string, hh: number) => {
    const i = w.hourly.time.indexOf(`${date}T${String(hh).padStart(2, "0")}:00`);
    return i < 0 ? null : hourOf(i);
  };

  const endHour = Math.floor(toMin(workEnd) / 60);   // 14 for 2:30 PM
  const drivesFor = (date: string) => {
    const driveIn = hourAt(date, 5);
    const homeA = hourAt(date, endHour);
    const homeB = hourAt(date, endHour + 1);
    let driveHome = null;
    if (homeA && homeB) {
      const wetter = homeA.rain >= homeB.rain ? homeA : homeB;
      driveHome = { temp: homeB.temp, rain: wetter.rain, kind: wetter.kind, label: wetter.label };
    }
    return { driveIn, driveHome };
  };

  const todayDrives = drivesFor(today);
  const tomorrowDate = addDays(today, 1);

  // Next 48 hours from midnight today; the screen picks the next 10 from "now".
  const hourly = w.hourly.time.slice(0, 48).map((time: string, i: number) => ({
    time,
    ...hourOf(i),
  }));

  const days = w.daily.time.map((date: string, i: number) => ({
    date,
    name: shortDay(date),
    hi: Math.round(w.daily.temperature_2m_max[i]),
    lo: Math.round(w.daily.temperature_2m_min[i]),
    rain: w.daily.precipitation_probability_max[i] ?? 0,
    ...describe(w.daily.weather_code[i]),
  }));

  const timeOnly = (s: string | undefined) => (s ? s.slice(11, 16) : null);

  return {
    now: { temp: Math.round(w.current.temperature_2m), ...describe(w.current.weather_code) },
    driveIn: todayDrives.driveIn,
    driveHome: todayDrives.driveHome,
    today: {
      sunrise: timeOnly(w.daily.sunrise?.[0]),
      sunset: timeOnly(w.daily.sunset?.[0]),
      uv: w.daily.uv_index_max?.[0] != null ? Math.round(w.daily.uv_index_max[0]) : null,
    },
    tomorrow: { date: tomorrowDate, ...drivesFor(tomorrowDate) },
    hourly,
    days,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------- commute (Google Routes API, live traffic) ----------
async function getCommute(today: string) {
  if (!GOOGLE_KEY || !HOME_ADDRESS || !WORK_ADDRESS) {
    console.error("commute: missing GOOGLE_MAPS_KEY / HOME_ADDRESS / WORK_ADDRESS secret");
    return null;
  }

  const { data: allowed, error } = await db.rpc("mirror_take_google_call", {
    p_date: today,
    p_max: GOOGLE_DAILY_MAX,
  });
  if (error || !allowed) {
    console.warn("commute: daily Google cap reached or counter failed", error);
    return null;
  }

  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
    },
    body: JSON.stringify({
      origin: { address: HOME_ADDRESS },
      destination: { address: WORK_ADDRESS },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
    }),
  });
  if (!r.ok) {
    console.error("routes", r.status, await r.text());
    return null;
  }

  const route = (await r.json()).routes?.[0];
  if (!route) return null;

  const sec = (s: string) => Number(String(s).replace("s", ""));
  const minutes = Math.round(sec(route.duration) / 60);
  const normalMinutes = Math.round(sec(route.staticDuration ?? route.duration) / 60);
  const delayMinutes = Math.max(0, minutes - normalMinutes);

  return {
    minutes,
    normalMinutes,
    delayMinutes,
    miles: Math.round(route.distanceMeters / 160.934) / 10,
    status: delayMinutes < 3 ? "normal" : delayMinutes < 10 ? "slower" : "heavy",
    fetchedAt: new Date().toISOString(),
  };
}

// ---------- photos (private Supabase Storage bucket) ----------
async function getPhotos(): Promise<string[] | null> {
  const bucket = db.storage.from(PHOTO_BUCKET);
  const { data, error } = await bucket.list("", {
    limit: 200,
    sortBy: { column: "name", order: "asc" },
  });

  if (error) {
    // First run: the bucket doesn't exist yet, so create it (private).
    const created = await db.storage.createBucket(PHOTO_BUCKET, { public: false });
    if (created.error && !/exist/i.test(created.error.message)) {
      console.error("photos: create bucket", created.error);
      return null;
    }
    return [];
  }

  const names = (data ?? [])
    .filter((f) => f.id && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
    .map((f) => f.name);
  if (!names.length) return [];

  const { data: signed, error: signErr } = await bucket.createSignedUrls(names, PHOTO_LINK_HOURS * 3600);
  if (signErr) {
    console.error("photos: sign", signErr);
    return null;
  }
  return (signed ?? []).filter((s) => s.signedUrl).map((s) => s.signedUrl as string);
}

type Commute = NonNullable<Awaited<ReturnType<typeof getCommute>>>;
type Weather = NonNullable<Awaited<ReturnType<typeof getWeather>>>;

// ---------- Go button: today + this week ----------
async function getDepartures(today: string) {
  // Monday of this week
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  const monday = addDays(today, -((dow + 6) % 7));
  const since = addDays(today, -27);

  const { data, error } = await db
    .from("mirror_departures")
    .select("local_date, left_at, left_min, status")
    .gte("local_date", since)
    .order("local_date", { ascending: true });

  if (error) {
    // Table not created yet → the screen keeps Go taps locally until it is.
    console.warn("departures:", error.message);
    return null;
  }

  const rows = data ?? [];
  const week = rows.filter((r) => r.local_date >= monday);
  const avg = (list: typeof rows) =>
    list.length ? Math.round(list.reduce((n, r) => n + r.left_min, 0) / list.length) : null;

  return {
    today: rows.find((r) => r.local_date === today) ?? null,
    week: {
      count: week.length,
      onTime: week.filter((r) => r.status === "on_time").length,
      close: week.filter((r) => r.status === "close").length,
      late: week.filter((r) => r.status === "late").length,
      avgMin: avg(week),
    },
    last4Weeks: {
      count: rows.length,
      onTime: rows.filter((r) => r.status === "on_time").length,
      avgMin: avg(rows),
    },
  };
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!DEVICE_KEY || req.headers.get("x-mirror-key") !== DEVICE_KEY) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const { data: s, error } = await db
      .from("mirror_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (error) throw error;

    const now = localNow(s.timezone);
    const isWorkday = now.isWeekday;

    // Meds
    const medsMin = toMin(isWorkday ? s.meds_time_weekday : s.meds_time_weekend);
    const { data: med } = await db
      .from("mirror_meds_log")
      .select("taken_at, source")
      .eq("local_date", now.date)
      .maybeSingle();

    // Refill
    let refill = null;
    if (s.last_refill_date) {
      const runOutDate = addDays(s.last_refill_date, s.days_supply);
      const daysLeft = daysBetween(now.date, runOutDate);
      refill = {
        lastRefill: s.last_refill_date,
        runOutDate,
        daysLeft,
        due: daysLeft <= s.refill_lead_days,
      };
    }

    // Weather
    const weather = await cached<Weather>(
      `weather2:${now.date}`,
      WEATHER_TTL_MIN,
      () => getWeather(now.date, s.timezone, s.work_end_time),
    );

    // Commute (weekday mornings only)
    let commute = null;
    if (
      isWorkday &&
      now.minutes >= COMMUTE_WINDOW_START &&
      now.minutes <= COMMUTE_WINDOW_END
    ) {
      const c = await cached<Commute>(
        `commute:${now.date}`,
        COMMUTE_TTL_MIN,
        () => getCommute(now.date),
      );
      if (c) {
        const ideal = toMin(s.leave_ideal_time);
        const latest = toMin(s.leave_latest_time);
        const leaveBy = Math.min(ideal, toMin(s.arrive_goal_time) - c.minutes);
        const leaveLatest = Math.min(latest, toMin(s.work_start_time) - c.minutes);
        commute = {
          ...c,
          leaveBy: fromMin(leaveBy),
          leaveLatest: fromMin(leaveLatest),
          movedEarlier: leaveBy < ideal,
        };
      }
    }

    // Photos (slideshow on the weekend / off-hours view)
    const photos = (await cached<string[]>("photos", PHOTOS_TTL_MIN, getPhotos)) ?? [];
    const departures = await getDepartures(now.date);

    return json({
      now: { date: now.date, weekday: now.weekday, minutes: now.minutes },
      photos,
      departures,
      isWorkday,
      schedule: {
        alarm: "04:15",
        leaveIdeal: s.leave_ideal_time.slice(0, 5),
        leaveLatest: s.leave_latest_time.slice(0, 5),
        arriveGoal: s.arrive_goal_time.slice(0, 5),
        workStart: s.work_start_time.slice(0, 5),
        workEnd: s.work_end_time.slice(0, 5),
      },
      meds: {
        time: fromMin(medsMin),
        taken: !!med,
        takenAt: med?.taken_at ?? null,
        source: med?.source ?? null,
      },
      refill,
      weather,
      commute,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
