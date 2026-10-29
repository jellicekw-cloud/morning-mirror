// ============================================================
// mirror-scheduler
// Called every 5 minutes by pg_cron (x-mirror-key = MIRROR_CRON_KEY).
// Decides, in New York time, whether to send a phone nudge:
//   • Meds: not logged 10 min after the meds time (5:00 weekdays, 9:00 weekends)
//   • Refill: once per refill cycle, 3 days before run-out, at 9:00 AM
// Each nudge is sent at most once (mirror_nudge_log).
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const CRON_KEY = Deno.env.get("MIRROR_CRON_KEY") ?? "";
const NTFY_TOPIC = Deno.env.get("NTFY_TOPIC") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const MEDS_URL = `${SUPABASE_URL}/functions/v1/mirror-meds`;
const MEDS_NUDGE_WINDOW_MIN = 120;   // stop trying 2 hours after the nudge time

const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    isWeekday: !["Sat", "Sun"].includes(p.weekday),
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function time12(n: number) {
  const h = Math.floor(n / 60);
  const m = n % 60;
  const ap = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${ap}`;
}

function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function prettyDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}


// ---------- office / work-from-home / day off ----------
type DayMode = "office" | "wfh" | "off";

function weekdayOf(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
}

function defaultMode(s: Record<string, unknown>, date: string): DayMode {
  const dow = weekdayOf(date);
  if (dow === 0 || dow === 6) return "off";
  const wfh = Array.isArray(s.wfh_weekdays) ? (s.wfh_weekdays as number[]) : [5];
  return wfh.includes(dow) ? "wfh" : "office";
}

/** Today's and tomorrow's mode, including one-off changes. */
async function dayModes(s: Record<string, unknown>, today: string) {
  const tomorrow = addDays(today, 1);
  const modes = { today: defaultMode(s, today), tomorrow: defaultMode(s, tomorrow), todayChanged: false, tomorrowChanged: false };
  const { data, error } = await db
    .from("mirror_day_mode")
    .select("local_date, mode")
    .in("local_date", [today, tomorrow]);
  if (error) return modes; // table not set up yet → defaults
  for (const row of data ?? []) {
    if (row.local_date === today && modes.today !== "off") {
      modes.todayChanged = row.mode !== modes.today;
      modes.today = row.mode;
    }
    if (row.local_date === tomorrow && modes.tomorrow !== "off") {
      modes.tomorrowChanged = row.mode !== modes.tomorrow;
      modes.tomorrow = row.mode;
    }
  }
  return modes;
}

function medsTimeFor(s: Record<string, string>, mode: DayMode) {
  if (mode === "off") return s.meds_time_weekend;
  if (mode === "wfh") return s.wfh_meds_time ?? "06:00";
  return s.meds_time_weekday;
}

// ---------- nudge bookkeeping ----------
async function claimNudge(localDate: string, kind: "meds" | "refill") {
  const { error } = await db.from("mirror_nudge_log").insert({ local_date: localDate, kind });
  if (!error) return true;
  if (error.code === "23505") return false;   // already sent today
  throw error;
}

async function releaseNudge(localDate: string, kind: "meds" | "refill") {
  await db.from("mirror_nudge_log").delete().eq("local_date", localDate).eq("kind", kind);
}

// ---------- ntfy ----------
function phoneButton(label: string, action: "took" | "refilled") {
  return {
    action: "http",
    label,
    url: MEDS_URL,
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mirror-key": CRON_KEY },
    body: JSON.stringify({ action }),
    clear: true,
  };
}

async function ntfy(msg: Record<string, unknown>) {
  const r = await fetch("https://ntfy.sh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: NTFY_TOPIC, ...msg }),
  });
  if (!r.ok) throw new Error(`ntfy ${r.status}: ${await r.text()}`);
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (!CRON_KEY || req.headers.get("x-mirror-key") !== CRON_KEY) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!NTFY_TOPIC) return json({ error: "missing NTFY_TOPIC secret" }, 500);

  const sent: string[] = [];

  try {
    const { data: s, error } = await db
      .from("mirror_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (error) throw error;

    const now = localNow(s.timezone);

    // ---- Meds nudge ----
    const mode = await dayModes(s, now.date);
    const medsMin = toMin(medsTimeFor(s, mode.today));
    const nudgeAt = medsMin + s.meds_nudge_delay_min;

    if (now.minutes >= nudgeAt && now.minutes < nudgeAt + MEDS_NUDGE_WINDOW_MIN) {
      const { data: med } = await db
        .from("mirror_meds_log")
        .select("id")
        .eq("local_date", now.date)
        .maybeSingle();

      if (!med && (await claimNudge(now.date, "meds"))) {
        try {
          await ntfy({
            title: "Meds not logged yet",
            message: `Your ${time12(medsMin)} medication hasn't been marked as taken.`,
            priority: 4,
            actions: [phoneButton("Took it", "took")],
          });
          sent.push("meds");
        } catch (e) {
          await releaseNudge(now.date, "meds");   // retry on the next run
          throw e;
        }
      }
    }

    // ---- Refill nudge (once per refill cycle) ----
    if (s.last_refill_date && now.minutes >= toMin(s.refill_nudge_time)) {
      const runOut = addDays(s.last_refill_date, s.days_supply);
      const warnFrom = addDays(runOut, -s.refill_lead_days);

      if (now.date >= warnFrom) {
        const { count } = await db
          .from("mirror_nudge_log")
          .select("local_date", { count: "exact", head: true })
          .eq("kind", "refill")
          .gte("local_date", warnFrom);

        if (!count && (await claimNudge(now.date, "refill"))) {
          try {
            await ntfy({
              title: "Time to refill your meds",
              message: `Your supply runs out around ${prettyDate(runOut)}. Tap Refilled once you pick it up.`,
              priority: 3,
              actions: [phoneButton("Refilled", "refilled")],
            });
            sent.push("refill");
          } catch (e) {
            await releaseNudge(now.date, "refill");
            throw e;
          }
        }
      }
    }

    return json({ ok: true, date: now.date, minutes: now.minutes, sent });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error", sent }, 500);
  }
});
