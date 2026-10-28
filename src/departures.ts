// "Go" button: record when you leave, grade it, and keep a weekly tally.
//
// Taps are saved on the tablet first, then sent to Supabase. If Supabase
// can't take them yet (offline, or the table isn't set up), they wait here
// and are sent automatically later, so no tap is lost.
import { medsAction, type Departure, type DepartureStats, type DepartureStatus, type MirrorData } from "./api";
import { toMin } from "./time";

const LOG_KEY = "mirror-go-log";

export interface LocalDeparture extends Departure {
  synced: boolean;
}

export function gradeDeparture(leftMin: number, leaveIdeal: string, leaveLatest: string): DepartureStatus {
  if (leftMin <= toMin(leaveIdeal)) return "on_time";
  if (leftMin <= toMin(leaveLatest)) return "close";
  return "late";
}

export const STATUS_TEXT: Record<DepartureStatus, string> = {
  on_time: "On time",
  close: "Cutting it close",
  late: "Late",
};

export function readLog(): LocalDeparture[] {
  try {
    const list = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLog(list: LocalDeparture[]) {
  try {
    // Keep about two months.
    localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-60)));
  } catch {
    /* storage blocked */
  }
}

export function recordLocal(entry: Departure): LocalDeparture[] {
  const list = readLog();
  if (!list.some((d) => d.local_date === entry.local_date)) {
    list.push({ ...entry, synced: false });
  }
  writeLog(list);
  return list;
}

export function removeLocal(date: string): LocalDeparture[] {
  const list = readLog().filter((d) => d.local_date !== date);
  writeLog(list);
  return list;
}

function markSynced(date: string) {
  writeLog(readLog().map((d) => (d.local_date === date ? { ...d, synced: true } : d)));
}

/** Send anything still waiting, once the server is ready for it. */
export async function flushPending(key: string, data: MirrorData) {
  if (!data.departures) return false; // server not set up yet
  let sent = false;
  for (const d of readLog().filter((x) => !x.synced)) {
    try {
      await medsAction(key, "go", d.left_at);
      markSynced(d.local_date);
      sent = true;
    } catch {
      break; // try again on the next refresh
    }
  }
  return sent;
}

export async function sendGo(key: string, entry: Departure) {
  try {
    await medsAction(key, "go");
    markSynced(entry.local_date);
  } catch {
    /* stays queued; flushPending retries */
  }
}

// ---------- what the screen shows ----------
function mondayOf(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const back = (dow + 6) % 7;
  return new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10);
}

function statsFrom(list: Departure[]): DepartureStats {
  return {
    count: list.length,
    onTime: list.filter((d) => d.status === "on_time").length,
    close: list.filter((d) => d.status === "close").length,
    late: list.filter((d) => d.status === "late").length,
    avgMin: list.length ? Math.round(list.reduce((n, d) => n + d.left_min, 0) / list.length) : null,
  };
}

/** Today's departure and this week's tally: server first, tablet copy as backup. */
export function departureView(data: MirrorData | null, today: string, log: LocalDeparture[]) {
  const localToday = log.find((d) => d.local_date === today) ?? null;
  const serverToday = data?.departures?.today ?? null;

  let week: DepartureStats;
  if (data?.departures) {
    // Server tally, plus any taps still waiting to be sent.
    const monday = mondayOf(today);
    const serverDates = new Set<string>();
    if (serverToday) serverDates.add(serverToday.local_date);
    const pending = log.filter((d) => !d.synced && d.local_date >= monday && !serverDates.has(d.local_date));
    const base = data.departures.week;
    if (!pending.length) {
      week = base;
    } else {
      const extra = statsFrom(pending);
      const count = base.count + extra.count;
      week = {
        count,
        onTime: base.onTime + extra.onTime,
        close: base.close + extra.close,
        late: base.late + extra.late,
        avgMin:
          count === 0
            ? null
            : Math.round(((base.avgMin ?? 0) * base.count + (extra.avgMin ?? 0) * extra.count) / count),
      };
    }
  } else {
    week = statsFrom(log.filter((d) => d.local_date >= mondayOf(today)));
  }

  return { today: serverToday ?? localToday, week };
}
