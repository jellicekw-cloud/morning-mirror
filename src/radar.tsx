// Live radar loop for metro Atlanta.
// Radar: RainViewer free tier (past 2 hours, 10-minute frames, max native zoom 7).
// Base map: CARTO dark tiles. No keys needed for either.
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TZ } from "./time";

const CENTER: [number, number] = [33.749, -84.388];
const ZOOM = 8;
const FRAME_MS = 600;
const HOLD_LAST_MS = 2000;
const REFRESH_MS = 10 * 60 * 1000;

interface Frame {
  time: number;
  path: string;
}

function frameTime(unix: number) {
  return new Date(unix * 1000).toLocaleTimeString("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function RadarCard() {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.TileLayer[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [current, setCurrent] = useState(0);
  const [failed, setFailed] = useState(false);

  // Map once.
  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, {
      center: CENTER,
      zoom: ZOOM,
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      boxZoom: false,
      keyboard: false,
    });
    m.attributionControl.setPrefix(false);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 10,
      attribution: "© OpenStreetMap © CARTO · Radar: RainViewer",
    }).addTo(m);
    L.circleMarker(CENTER, { radius: 4, color: "#b794f6", fillColor: "#b794f6", fillOpacity: 1, weight: 2 }).addTo(m);
    map.current = m;
    // The card can resize as other cards come and go.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  // Radar frames, refreshed every 10 minutes.
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-store" });
        const j = await r.json();
        const host: string = j.host;
        const past: Frame[] = (j.radar?.past ?? []).map((f: Frame) => ({ time: f.time, path: host + f.path }));
        if (alive && past.length) {
          setFrames(past);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    }
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // One tile layer per frame, all loaded up front, shown one at a time.
  useEffect(() => {
    const m = map.current;
    if (!m || !frames.length) return;
    layers.current.forEach((l) => m.removeLayer(l));
    layers.current = frames.map((f) =>
      L.tileLayer(`${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
        maxNativeZoom: 7,
        maxZoom: 10,
        opacity: 0,
        zIndex: 10,
      }).addTo(m),
    );
    setCurrent(frames.length - 1);
  }, [frames]);

  // Animate: step through frames, pause on the newest.
  useEffect(() => {
    if (!frames.length) return;
    layers.current.forEach((l, n) => l.setOpacity(n === current ? 0.75 : 0));
    const last = current === frames.length - 1;
    const t = setTimeout(() => setCurrent((c) => (c + 1) % frames.length), last ? HOLD_LAST_MS : FRAME_MS);
    return () => clearTimeout(t);
  }, [current, frames]);

  const f = frames[current];
  const isLatest = current === frames.length - 1;

  return (
    <div className="radar">
      <div ref={box} className="radar-map" />
      <div className="radar-label">
        <span className="radar-title">Radar</span>
        {failed && !frames.length ? (
          <span>unavailable</span>
        ) : f ? (
          <span className={isLatest ? "radar-now" : ""}>{isLatest ? `Now · ${frameTime(f.time)}` : frameTime(f.time)}</span>
        ) : (
          <span>loading…</span>
        )}
      </div>
    </div>
  );
}
