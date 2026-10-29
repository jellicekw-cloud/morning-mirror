// ============================================================
// mirror-meds
// "Took it", "Undo", "Refilled", and the "Go" button — from the
// screen or from the buttons on your phone notification.
//
// POST body: { "action": "took" | "undo" | "refilled" | "go" | "go_undo", "at"?: ISO time }
//        or { "action": "mode", "day": "today" | "tomorrow", "mode": "office" | "wfh" | "auto" }
//   "at" lets the screen send a Go tap it saved while offline.
// Header x-mirror-key:
//   MIRROR_DEVICE_KEY → from the screen
//   MIRROR_CRON_KEY   → from a phone notification button
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const DEVICE_KEY = Deno.env.get("MIRROR_DEVICE_KEY") ?? "";
const CRON_KEY = Deno.env.get("MIRROR_CRON_KEY") ?? "";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-mirror-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function localMinutes(tz: string, d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  return Number(p.hour) * 60 + Number(p.minute);
}

function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function localDate(tz: string, d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = req.headers.get("x-mirror-key") ?? "";
  let source: "screen" | "phone";
  if (DEVICE_KEY && key === DEVICE_KEY) source = "screen";
  else if (CRON_KEY && key === CRON_KEY) source = "phone";
  else return json({ error: "unauthorized" }, 401);

  let action = "";
  let at: Date | null = null;
  let day = "";
  let mode = "";
  try {
    const body = await req.json();
    action = body?.action ?? "";
    day = body?.day ?? "";
    mode = body?.mode ?? "";
    if (body?.at) {
      const d = new Date(body.at);
      // Only accept a saved tap from the last 7 days, never the future.
      if (!isNaN(d.getTime()) && d.getTime() <= Date.now() + 60000 && Date.now() - d.getTime() < 7 * 86400000) {
        at = d;
      }
    }
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  try {
    const { data: s, error: sErr } = await db
      .from("mirror_settings")
      .select("timezone, days_supply, leave_ideal_time, leave_latest_time")
      .eq("id", 1)
      .single();
    if (sErr) throw sErr;

    const today = localDate(s.timezone);

    if (action === "took") {
      const { error } = await db.from("mirror_meds_log").upsert(
        { local_date: today, taken_at: new Date().toISOString(), source },
        { onConflict: "local_date" },
      );
      if (error) throw error;
      return json({ ok: true, action, date: today, source });
    }

    if (action === "undo") {
      const { error } = await db.from("mirror_meds_log").delete().eq("local_date", today);
      if (error) throw error;
      return json({ ok: true, action, date: today });
    }

    if (action === "refilled") {
      const { error: logErr } = await db.from("mirror_refill_log").insert({
        refilled_on: today,
        days_supply: s.days_supply,
        source,
      });
      if (logErr) throw logErr;

      const { error: upErr } = await db
        .from("mirror_settings")
        .update({ last_refill_date: today, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (upErr) throw upErr;

      return json({ ok: true, action, date: today, daysSupply: s.days_supply });
    }

    if (action === "go") {
      const when = at ?? new Date();
      const date = localDate(s.timezone, when);
      const leftMin = localMinutes(s.timezone, when);
      const status =
        leftMin <= toMin(s.leave_ideal_time)
          ? "on_time"
          : leftMin <= toMin(s.leave_latest_time)
            ? "close"
            : "late";

      // First tap of the day wins; a second tap doesn't overwrite it.
      const { error } = await db.from("mirror_departures").upsert(
        { local_date: date, left_at: when.toISOString(), left_min: leftMin, status, source },
        { onConflict: "local_date", ignoreDuplicates: true },
      );
      if (error) throw error;
      return json({ ok: true, action, date, leftMin, status });
    }

    if (action === "go_undo") {
      const { error } = await db.from("mirror_departures").delete().eq("local_date", today);
      if (error) throw error;
      return json({ ok: true, action, date: today });
    }

    if (action === "mode") {
      if (!["today", "tomorrow"].includes(day) || !["office", "wfh", "auto"].includes(mode)) {
        return json({ error: "bad_mode" }, 400);
      }
      const [y, m, d] = today.split("-").map(Number);
      const date =
        day === "today" ? today : new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      if (mode === "auto") {
        const { error } = await db.from("mirror_day_mode").delete().eq("local_date", date);
        if (error) throw error;
      } else {
        const { error } = await db
          .from("mirror_day_mode")
          .upsert({ local_date: date, mode, set_at: new Date().toISOString() }, { onConflict: "local_date" });
        if (error) throw error;
      }
      return json({ ok: true, action, date, mode });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
