// Severe weather alert crawl, straight from the National Weather Service.
// Hidden unless there's an active alert for this spot. Free, no key.
import { useEffect, useState } from "react";

const POINT = "33.749,-84.388";
const REFRESH_MS = 5 * 60 * 1000;

export interface WxAlert {
  id: string;
  event: string;        // "Tornado Warning"
  headline: string;
  severity: string;     // Extreme | Severe | Moderate | Minor | Unknown
}

function level(a: WxAlert): "warning" | "watch" | "advisory" {
  const e = a.event.toLowerCase();
  if (e.includes("warning") || a.severity === "Extreme" || a.severity === "Severe") return "warning";
  if (e.includes("watch")) return "watch";
  return "advisory";
}

export function useWeatherAlerts() {
  const [alerts, setAlerts] = useState<WxAlert[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch(`https://api.weather.gov/alerts/active?point=${POINT}`, {
          headers: { Accept: "application/geo+json" },
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = await r.json();
        const list: WxAlert[] = (j.features ?? []).map((f: { id: string; properties: Record<string, string> }) => ({
          id: f.id,
          event: f.properties.event,
          headline: f.properties.headline ?? f.properties.event,
          severity: f.properties.severity ?? "Unknown",
        }));
        if (alive) setAlerts(list);
      } catch {
        /* keep the last known list */
      }
    }
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return alerts;
}

export function AlertTicker({ alerts }: { alerts: WxAlert[] }) {
  if (!alerts.length) return null;
  const order = { warning: 0, watch: 1, advisory: 2 };
  const sorted = [...alerts].sort((a, b) => order[level(a)] - order[level(b)]);
  const top = level(sorted[0]);
  const text = sorted.map((a) => `${a.event.toUpperCase()}: ${a.headline}`).join("     •     ");
  // Longer text scrolls a bit longer so the speed stays readable.
  const seconds = Math.max(18, Math.round(text.length / 6));

  return (
    <div className={`ticker ticker-${top}`} role="alert">
      <span className="ticker-tag">{sorted.length > 1 ? `${sorted.length} ALERTS` : "ALERT"}</span>
      <div className="ticker-track">
        <span className="ticker-text" style={{ animationDuration: `${seconds}s` }}>
          {text}
        </span>
      </div>
    </div>
  );
}
