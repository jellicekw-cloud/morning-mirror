import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMirror,
  KeyRejectedError,
  loadDeviceKey,
  medsAction,
  type HourSlot,
  type Kind,
  type MirrorData,
} from "./api";
import { fmt12, nyNow, prettyDate, timeOfIso, toMin, type NyNow } from "./time";
import { BellIcon, CarIcon, CheckIcon, WeatherIcon } from "./icons";
import { pickIdeas } from "./saturday";

const REFRESH_MS = 2 * 60 * 1000;
const MORNING_START = 4 * 60;        // 4:00 AM
const MORNING_END = 5 * 60 + 30;     // 5:30 AM
const NIGHT_START = 21 * 60;         // 9:00 PM → black screen
const NIGHT_END = 4 * 60;            // until 4:00 AM
const DAILY_RELOAD = 3 * 60 + 55;    // reload at 3:55 AM to pick up new deploys
const PREVIEW_FROM = 16 * 60;        // from 4 PM, show "Tomorrow" before a workday
const PHOTO_SECONDS = 30;
const HOURLY_COUNT = 10;
const PAYDAY_ANCHOR = "2026-10-30";  // every other Friday from here
const IDEAS_START = 7 * 60;          // Saturday ideas card: 7 AM…
const IDEAS_END = 18 * 60;           // …to 6 PM

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------
function dayIndex(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sun
}

function weekdayLong(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

function daysBetween(from: string, to: string) {
  const a = from.split("-").map(Number);
  const b = to.split("-").map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function nextPayday(today: string) {
  const since = daysBetween(PAYDAY_ANCHOR, today);
  const daysUntil = since < 0 ? -since : (14 - (since % 14)) % 14;
  const date = addDays(today, daysUntil);
  const label =
    daysUntil === 0
      ? "Today"
      : daysUntil === 1
        ? "Tomorrow"
        : daysUntil <= 6
          ? weekdayLong(date)
          : prettyDate(date);
  const sub = daysUntil === 0 ? "It's payday" : `in ${daysUntil} days`;
  return { label, sub };
}

function hourLabel(time: string) {
  const h = Number(time.slice(11, 13));
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
}

/** Clear-sky "sun" becomes a moon between sunset and sunrise. */
function dayOrNight(kind: Kind, minutes: number, sunrise?: string | null, sunset?: string | null): Kind {
  if (kind !== "sun") return kind;
  const rise = sunrise ? toMin(sunrise) : 7 * 60;
  const set = sunset ? toMin(sunset) : 19 * 60;
  return minutes < rise || minutes >= set ? "moon" : "sun";
}

function uvLabel(uv: number) {
  if (uv < 3) return "Low";
  if (uv < 6) return "Moderate";
  if (uv < 8) return "High";
  if (uv < 11) return "Very high";
  return "Extreme";
}

// ------------------------------------------------------------
// Hooks
// ------------------------------------------------------------
function useNow() {
  const [now, setNow] = useState<NyNow>(() => nyNow());
  useEffect(() => {
    const t = setInterval(() => setNow(nyNow()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useMirrorData(key: string | null) {
  const [data, setData] = useState<MirrorData | null>(null);
  const [offline, setOffline] = useState(false);
  const [keyRejected, setKeyRejected] = useState(false);
  const [lastOk, setLastOk] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    if (!key) return;
    try {
      setData(await fetchMirror(key));
      setOffline(false);
      setKeyRejected(false);
      setLastOk(new Date());
    } catch (e) {
      console.error(e);
      setOffline(true);
      setKeyRejected(e instanceof KeyRejectedError);
    }
  }, [key]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { data, setData, offline, keyRejected, lastOk, refresh };
}

function useDailyReload() {
  const loadedDate = useRef(nyNow().date);
  useEffect(() => {
    const t = setInterval(() => {
      const n = nyNow();
      if (n.date !== loadedDate.current && n.minutes >= DAILY_RELOAD) {
        window.location.reload();
      }
    }, 60 * 1000);
    return () => clearInterval(t);
  }, []);
}

// ------------------------------------------------------------
// App
// ------------------------------------------------------------
export default function App() {
  const [key] = useState(loadDeviceKey);
  const now = useNow();
  const { data, setData, offline, keyRejected, lastOk, refresh } = useMirrorData(key);
  const [busy, setBusy] = useState(false);
  useDailyReload();

  if (!key) return <Setup />;
  if (keyRejected && !data) return <Setup rejected />;

  const night = now.minutes >= NIGHT_START || now.minutes < NIGHT_END;
  if (night) return <Night now={now} />;

  const morning = now.isWeekday && now.minutes >= MORNING_START && now.minutes <= MORNING_END;

  const tomorrow = data?.weather?.tomorrow;
  const tomorrowIsWorkday = tomorrow ? [1, 2, 3, 4, 5].includes(dayIndex(tomorrow.date)) : false;
  const showPreview = !morning && now.minutes >= PREVIEW_FROM && tomorrowIsWorkday;
  const forceIdeas = new URLSearchParams(window.location.search).has("ideas"); // preview: add ?ideas
  const showIdeas =
    !morning &&
    (forceIdeas || (dayIndex(now.date) === 6 && now.minutes >= IDEAS_START && now.minutes < IDEAS_END));

  async function act(action: "took" | "undo" | "refilled") {
    if (!key || !data || busy) return;
    setBusy(true);
    // Update the screen right away, then confirm with the server.
    if (action === "took") {
      setData({ ...data, meds: { ...data.meds, taken: true, takenAt: new Date().toISOString(), source: "screen" } });
    } else if (action === "undo") {
      setData({ ...data, meds: { ...data.meds, taken: false, takenAt: null, source: null } });
    }
    try {
      await medsAction(key, action);
    } catch (e) {
      console.error(e);
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  return (
    <div className="mirror">
      {morning && data && <ProgressBar now={now} data={data} />}

      <main className="main">
        <section className="hero">
          <div className="date">{now.dateLabel}</div>
          <div className={`clock ${showIdeas ? "clock-compact" : ""}`}>
            <span className="clock-time">{now.clock}</span>
            <span className="clock-ampm">{now.ampm}</span>
          </div>
          {morning && data && <Countdown now={now} data={data} />}
          {morning && <GrabChecklist date={now.date} />}
          {!morning && data?.weather?.hourly && (
            <HourlyStrip
              now={now}
              hours={data.weather.hourly}
              sunrise={data.weather.today?.sunrise}
              sunset={data.weather.today?.sunset}
            />
          )}
          {showIdeas && data?.weather && (
            <IdeasCard date={now.date} rainChance={data.weather.days[0]?.rain ?? 0} />
          )}
        </section>

        <section className="side">
          {data && <MedsCard data={data} now={now} morning={morning} busy={busy} onAction={act} />}
          {morning && data && <CommuteCard data={data} />}
          {!morning && data && showPreview && <TomorrowCard data={data} />}
          {!morning && data && !showPreview && <PhotoCard photos={data.photos ?? []} />}
          {data?.weather && <WeatherCard data={data} morning={morning} nowMin={now.minutes} />}
          {!morning && data && <PaydayCard today={now.date} />}
          {!data && <div className="card muted">{offline ? "Can't reach the server yet…" : "Loading…"}</div>}
        </section>
      </main>

      {data?.weather && <WeekStrip data={data} />}

      {offline && lastOk && (
        <div className="offline">Offline · last updated {timeOfIso(lastOk.toISOString())}</div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Weekday morning pieces
// ------------------------------------------------------------
function ProgressBar({ now, data }: { now: NyNow; data: MirrorData }) {
  const start = toMin(data.schedule.alarm);
  const end = toMin(data.commute?.leaveBy ?? data.schedule.leaveIdeal);
  const exact = now.minutes + now.seconds / 60;
  const total = Math.max(1, end - start);
  const used = Math.min(total, Math.max(0, exact - start));
  const pct = (used / total) * 100;
  const over = exact > end;

  return (
    <div className="progress">
      <div className="progress-labels">
        <span>{fmt12(start)} Alarm</span>
        <span className="progress-mid">
          {over ? "Time to go" : `${Math.floor(used)} of ${total} min used`}
        </span>
        <span>{fmt12(end)} Out the door</span>
      </div>
      <div className="progress-track">
        <div className={`progress-fill ${over ? "is-over" : ""}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Edit this list to change what shows up. Ticks reset every morning.
const GRAB_ITEMS = ["Keys", "Water bottle", "Badge"];
const GRAB_STORAGE = "mirror-grab";

function loadTicks(date: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(GRAB_STORAGE) ?? "null");
    return saved?.date === date && Array.isArray(saved.items) ? saved.items : [];
  } catch {
    return [];
  }
}

function GrabChecklist({ date }: { date: string }) {
  const [ticked, setTicked] = useState<string[]>(() => loadTicks(date));

  // New day → fresh list.
  useEffect(() => {
    setTicked(loadTicks(date));
  }, [date]);

  function toggle(item: string) {
    const next = ticked.includes(item) ? ticked.filter((i) => i !== item) : [...ticked, item];
    setTicked(next);
    try {
      localStorage.setItem(GRAB_STORAGE, JSON.stringify({ date, items: next }));
    } catch {
      /* storage blocked: still works until the page reloads */
    }
  }

  const allDone = GRAB_ITEMS.every((i) => ticked.includes(i));

  return (
    <div className="grab">
      <span className="card-label">{allDone ? "Got everything" : "Grab before you go"}</span>
      <div className="grab-row">
        {GRAB_ITEMS.map((item) => {
          const on = ticked.includes(item);
          return (
            <button
              type="button"
              key={item}
              className={`grab-item ${on ? "is-on" : ""}`}
              aria-pressed={on}
              onClick={() => toggle(item)}
            >
              <span className="grab-box" aria-hidden="true">
                {on && (
                  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12 5 5 9-10" />
                  </svg>
                )}
              </span>
              {item}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Countdown({ now, data }: { now: NyNow; data: MirrorData }) {
  const leaveBy = toMin(data.commute?.leaveBy ?? data.schedule.leaveIdeal);
  const latest = toMin(data.commute?.leaveLatest ?? data.schedule.leaveLatest);
  const exact = now.minutes + now.seconds / 60;
  const left = Math.ceil(leaveBy - exact);

  let state: "calm" | "warn" | "late";
  let text: string;
  if (left > 0) {
    state = "calm";
    text = `Leave in ${left} min`;
  } else if (exact < latest) {
    state = "warn";
    text = `Leave now`;
  } else {
    state = "late";
    text = "Running late";
  }

  return (
    <>
      <div className={`pill pill-${state}`}>{text}</div>
      <div className="hero-sub">
        {data.commute?.movedEarlier ? (
          <span className="warn-text">Traffic: leave by {fmt12(leaveBy)} · </span>
        ) : (
          <>Ideal {fmt12(data.schedule.leaveIdeal)} · </>
        )}
        Latest {fmt12(latest)} · Goal there by {fmt12(data.schedule.arriveGoal)}
      </div>
    </>
  );
}

function CommuteCard({ data }: { data: MirrorData }) {
  const c = data.commute;
  const statusText = c
    ? c.status === "normal"
      ? "Normal"
      : c.status === "slower"
        ? `+${c.delayMinutes} min`
        : `Heavy · +${c.delayMinutes} min`
    : "";

  return (
    <div className="card">
      <div className="card-label">
        <CarIcon size="1.1em" />
        <span>Commute to work</span>
      </div>
      {c ? (
        <>
          <div className="commute-row">
            <span className="big">{c.minutes} min</span>
            <span className={`status status-${c.status}`}>{statusText}</span>
          </div>
          <span className="card-sub muted-text">
            {c.status === "normal"
              ? "Traffic looks normal on your route"
              : `Usually ${c.normalMinutes} min · ${c.miles} mi`}
          </span>
        </>
      ) : (
        <span className="card-sub muted-text">Traffic unavailable right now</span>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Weekend / off-hours pieces
// ------------------------------------------------------------
function HourlyStrip({
  now,
  hours,
  sunrise,
  sunset,
}: {
  now: NyNow;
  hours: HourSlot[];
  sunrise?: string | null;
  sunset?: string | null;
}) {
  const hh = String(Math.floor(now.minutes / 60)).padStart(2, "0");
  const currentKey = `${now.date}T${hh}:00`;
  const next = hours.filter((h) => h.time > currentKey).slice(0, HOURLY_COUNT);
  if (!next.length) return null;

  return (
    <div className="hourly">
      <span className="card-label">Next {next.length} hours</span>
      <div className="hourly-grid" style={{ gridTemplateColumns: `repeat(${next.length}, minmax(0, 1fr))` }}>
        {next.map((h) => (
          <div className="hour" key={h.time}>
            <span className="hour-label">{hourLabel(h.time)}</span>
            <WeatherIcon kind={dayOrNight(h.kind, toMin(h.time.slice(11, 16)), sunrise, sunset)} size="1.3em" />
            <span className="hour-temp">{h.temp}°</span>
            <span className={`hour-rain ${h.rain >= 40 ? "rain-text" : "muted-text"}`}>{h.rain}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IdeasCard({ date, rainChance }: { date: string; rainChance: number }) {
  const ideas = pickIdeas(date, rainChance);
  return (
    <div className="ideas">
      <span className="card-label">
        Free &amp; cheap today{rainChance >= 50 ? " · rainy-day picks" : ""}
      </span>
      {ideas.map((idea) => (
        <div className="idea" key={idea.id}>
          <div className="idea-top">
            <span className="idea-name">{idea.name}</span>
            <span className={`idea-cost cost-${idea.cost === "Free" ? "free" : "paid"}`}>{idea.cost}</span>
          </div>
          <span className="idea-blurb">{idea.blurb}</span>
        </div>
      ))}
    </div>
  );
}

function PhotoCard({ photos }: { photos: string[] }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (photos.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % photos.length), PHOTO_SECONDS * 1000);
    return () => clearInterval(t);
  }, [photos.length]);

  // Preload the next photo so the swap is instant.
  useEffect(() => {
    if (photos.length < 2) return;
    const img = new Image();
    img.src = photos[(i + 1) % photos.length];
  }, [i, photos]);

  if (!photos.length) {
    return (
      <div className="photo photo-empty">
        <span className="photo-empty-title">Your photos go here</span>
        <span className="muted-text">Supabase → Storage → mirror-photos → Upload</span>
      </div>
    );
  }

  const src = photos[i % photos.length];
  return (
    <div className="photo">
      <img key={src} src={src} alt="" className="photo-img" />
    </div>
  );
}

function TomorrowCard({ data }: { data: MirrorData }) {
  const t = data.weather!.tomorrow!;
  const drive = (h: typeof t.driveIn) =>
    h ? `${h.temp}° · ${h.rain >= 30 ? `Rain ${h.rain}%` : "Dry"}` : "—";

  return (
    <div className="card tomorrow">
      <span className="card-label tomorrow-label">Tomorrow · {weekdayLong(t.date)}</span>
      <span className="tomorrow-title">Leave by {fmt12(data.schedule.leaveIdeal)}</span>
      <div className="weather-drives">
        <div className="drive-row">
          <span className="drive-label">Alarm</span>
          <span>{fmt12(data.schedule.alarm, true)}</span>
        </div>
        <div className="drive-row">
          <span className="drive-label">Drive in</span>
          <span>{drive(t.driveIn)}</span>
        </div>
        <div className="drive-row">
          <span className="drive-label">Drive home</span>
          {t.driveHome && t.driveHome.rain >= 40 ? (
            <span className="rain-text">Rain {t.driveHome.rain}% · bring umbrella</span>
          ) : (
            <span>{drive(t.driveHome)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function PaydayCard({ today }: { today: string }) {
  const p = nextPayday(today);
  return (
    <div className="card card-green countdown">
      <span className="card-label green-sub">Payday</span>
      <span className="countdown-title green">{p.label}</span>
      <span className="card-sub green-sub">{p.sub}</span>
    </div>
  );
}

// ------------------------------------------------------------
// Shared pieces
// ------------------------------------------------------------
function MedsCard({
  data,
  now,
  morning,
  busy,
  onAction,
}: {
  data: MirrorData;
  now: NyNow;
  morning: boolean;
  busy: boolean;
  onAction: (a: "took" | "undo" | "refilled") => void;
}) {
  const { meds, refill } = data;
  const medsMin = toMin(meds.time);
  // Outside the morning view, only show the card around meds time or when a refill is due.
  const nearMedsTime = now.minutes >= medsMin - 60;
  if (!morning && !refill?.due && (meds.taken || !nearMedsTime)) return null;

  const refillLine = refill?.due && (
    <div className="refill-row">
      <span>
        {refill.daysLeft > 0
          ? `Refill soon: runs out ${prettyDate(refill.runOutDate)}`
          : "Refill needed: supply is out"}
      </span>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAction("refilled")}>
        Refilled
      </button>
    </div>
  );

  if (meds.taken) {
    return (
      <div className="card card-green">
        <div className="card-row">
          <CheckIcon size="2.2em" />
          <div className="card-text">
            <span className="card-title green">Medication taken</span>
            <span className="card-sub green-sub">
              Logged at {meds.takenAt ? timeOfIso(meds.takenAt) : ""}
              {meds.source === "phone" ? " from your phone" : ""}
            </span>
          </div>
          <button type="button" className="btn btn-outline-green" disabled={busy} onClick={() => onAction("undo")}>
            Undo
          </button>
        </div>
        {refillLine}
      </div>
    );
  }

  const minsUntil = medsMin - now.minutes;
  const sub =
    minsUntil > 0
      ? `In ${minsUntil} min${morning ? ", before you head out" : ""}`
      : minsUntil === 0
        ? "Now"
        : minsUntil >= -60
          ? `${-minsUntil} min ago`
          : `Not logged yet today (due ${fmt12(meds.time, true)})`;

  return (
    <div className={`card card-amber ${minsUntil <= 0 ? "is-due" : ""}`}>
      <div className="card-row">
        <BellIcon size="2.2em" />
        <div className="card-text">
          <span className="card-title amber">Medication at {fmt12(meds.time)}</span>
          <span className="card-sub amber-sub">{sub}</span>
        </div>
        <button type="button" className="btn btn-amber" disabled={busy} onClick={() => onAction("took")}>
          Took it
        </button>
      </div>
      {refillLine}
    </div>
  );
}

function WeatherCard({ data, morning, nowMin }: { data: MirrorData; morning: boolean; nowMin: number }) {
  const w = data.weather!;
  const home = w.driveHome;
  const t = w.today;
  const nowKind = dayOrNight(w.now.kind, nowMin, t?.sunrise, t?.sunset);

  return (
    <div className="card weather">
      <div className="weather-now">
        <span className="card-label">Outside now</span>
        <div className="weather-temp">
          <WeatherIcon kind={nowKind} size="0.8em" />
          <span>{w.now.temp}°</span>
        </div>
        <span className="card-sub muted-text">{w.now.label}</span>
      </div>

      {morning ? (
        <>
          <div className="divider" />
          <div className="weather-drives">
            <div className="drive-row">
              <span className="drive-label">Drive in</span>
              <span>
                {w.driveIn
                  ? `${w.driveIn.rain >= 30 ? `Rain ${w.driveIn.rain}%` : "Dry"} · ${w.driveIn.temp}°`
                  : "—"}
              </span>
            </div>
            <div className="drive-row">
              <span className="drive-label">Drive home</span>
              {home ? (
                <span className={home.rain >= 40 ? "rain-text" : ""}>
                  {home.rain >= 40
                    ? `Rain ${home.rain}% · bring umbrella`
                    : `${home.rain >= 20 ? `Rain ${home.rain}%` : "Dry"} · ${home.temp}°`}
                </span>
              ) : (
                <span>—</span>
              )}
            </div>
          </div>
        </>
      ) : (
        t && (
          <>
            <div className="divider" />
            <div className="weather-drives">
              {t.sunrise && (
                <div className="drive-row">
                  <span className="drive-label">Sunrise</span>
                  <span>{fmt12(t.sunrise, true)}</span>
                </div>
              )}
              {t.sunset && (
                <div className="drive-row">
                  <span className="drive-label">Sunset</span>
                  <span>{fmt12(t.sunset, true)}</span>
                </div>
              )}
              {t.uv != null && (
                <div className="drive-row">
                  <span className="drive-label">UV</span>
                  <span className={t.uv >= 3 ? "warn-text" : ""}>
                    {t.uv} · {uvLabel(t.uv)}
                  </span>
                </div>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
}

function WeekStrip({ data }: { data: MirrorData }) {
  return (
    <div className="week">
      {data.weather!.days.map((d) => (
        <div className="day" key={d.date}>
          <span className="day-name">{d.name}</span>
          <WeatherIcon kind={d.kind} size="1.6em" />
          <span className="day-temps">
            {d.hi}° <span className="muted-text">{d.lo}°</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Night({ now }: { now: NyNow }) {
  return (
    <div className="night">
      {now.clock} {now.ampm}
    </div>
  );
}

function Setup({ rejected = false }: { rejected?: boolean }) {
  return (
    <div className="setup">
      <h1>Morning Mirror</h1>
      <p>
        {rejected
          ? "The device key saved on this screen doesn't match. It was probably mistyped."
          : "This screen needs its device key."}
      </p>
      <p>
        Open this page once with <code>?key=YOUR_DEVICE_KEY</code> on the end of the address. It's saved on
        this device after that.
      </p>
    </div>
  );
}
