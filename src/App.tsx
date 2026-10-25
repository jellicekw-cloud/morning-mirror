import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMirror, loadDeviceKey, medsAction, type MirrorData } from "./api";
import { fmt12, nyNow, prettyDate, timeOfIso, toMin, type NyNow } from "./time";
import { BellIcon, CarIcon, CheckIcon, WeatherIcon } from "./icons";

const REFRESH_MS = 2 * 60 * 1000;
const MORNING_START = 4 * 60;        // 4:00 AM
const MORNING_END = 5 * 60 + 30;     // 5:30 AM
const NIGHT_START = 21 * 60;         // 9:00 PM → black screen
const NIGHT_END = 4 * 60;            // until 4:00 AM
const DAILY_RELOAD = 3 * 60 + 55;    // reload at 3:55 AM to pick up new deploys

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
  const [lastOk, setLastOk] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    if (!key) return;
    try {
      setData(await fetchMirror(key));
      setOffline(false);
      setLastOk(new Date());
    } catch (e) {
      console.error(e);
      setOffline(true);
    }
  }, [key]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { data, setData, offline, lastOk, refresh };
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
  const { data, setData, offline, lastOk, refresh } = useMirrorData(key);
  const [busy, setBusy] = useState(false);
  useDailyReload();

  if (!key) return <Setup />;

  const night = now.minutes >= NIGHT_START || now.minutes < NIGHT_END;
  if (night) return <Night now={now} />;

  const morning = now.isWeekday && now.minutes >= MORNING_START && now.minutes <= MORNING_END;

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
          <div className="clock">
            <span className="clock-time">{now.clock}</span>
            <span className="clock-ampm">{now.ampm}</span>
          </div>
          {morning && data ? (
            <Countdown now={now} data={data} />
          ) : (
            data?.weather && (
              <div className="hero-sub">
                {data.weather.now.temp}° · {data.weather.now.label}
              </div>
            )
          )}
        </section>

        <section className="side">
          {data && <MedsCard data={data} now={now} morning={morning} busy={busy} onAction={act} />}
          {morning && data && <CommuteCard data={data} />}
          {data?.weather && <WeatherCard data={data} />}
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
// Pieces
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
        : `${-minsUntil} min ago`;

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

function WeatherCard({ data }: { data: MirrorData }) {
  const w = data.weather!;
  const home = w.driveHome;
  return (
    <div className="card weather">
      <div className="weather-now">
        <span className="card-label">Outside now</span>
        <div className="weather-temp">
          <WeatherIcon kind={w.now.kind} size="0.8em" />
          <span>{w.now.temp}°</span>
        </div>
        <span className="card-sub muted-text">{w.now.label}</span>
      </div>
      {data.isWorkday && (
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

function Setup() {
  return (
    <div className="setup">
      <h1>Morning Mirror</h1>
      <p>This screen needs its device key.</p>
      <p>
        Open this page once with <code>?key=YOUR_DEVICE_KEY</code> on the end of the address. It's saved on
        this device after that.
      </p>
    </div>
  );
}
