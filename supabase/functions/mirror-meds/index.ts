// ============================================================
// mirror-meds
// "Took it", "Undo", and "Refilled" — from the screen or from
// the buttons on your phone notification.
//
// POST body: { "action": "took" | "undo" | "refilled" }
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
  try {
    action = (await req.json())?.action ?? "";
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  try {
    const { data: s, error: sErr } = await db
      .from("mirror_settings")
      .select("timezone, days_supply")
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

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
