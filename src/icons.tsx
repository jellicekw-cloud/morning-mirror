import type { Kind } from "./api";

interface IconProps {
  size?: string;
}

const base = {
  fill: "none",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
};

export function WeatherIcon({ kind, size = "1em" }: { kind: Kind } & IconProps) {
  switch (kind) {
    case "sun":
      return (
        <svg {...base} width={size} height={size} stroke="var(--sun)">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case "moon":
      return (
        <svg {...base} width={size} height={size} stroke="var(--moon)">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      );
    case "rain":
      return (
        <svg {...base} width={size} height={size} stroke="var(--rain)">
          <path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3" />
          <path d="M8 19v2M8 13v2M16 19v2M16 13v2M12 21v2M12 15v2" />
        </svg>
      );
    case "storm":
      return (
        <svg {...base} width={size} height={size} stroke="var(--rain)">
          <path d="M19 16.9A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3" />
          <path d="m13 12-3 5h4l-3 5" />
        </svg>
      );
    case "snow":
      return (
        <svg {...base} width={size} height={size} stroke="var(--text)">
          <path d="M20 17.6A5 5 0 0 0 18 8h-1.3A8 8 0 1 0 4 16.3" />
          <path d="M8 16h.01M8 20h.01M12 18h.01M12 22h.01M16 16h.01M16 20h.01" />
        </svg>
      );
    case "fog":
      return (
        <svg {...base} width={size} height={size} stroke="var(--cloud)">
          <path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2" />
          <path d="M16 17H7M17 21H9" />
        </svg>
      );
    default:
      return (
        <svg {...base} width={size} height={size} stroke="var(--cloud)">
          <path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z" />
        </svg>
      );
  }
}

export function BellIcon({ size = "1em" }: IconProps) {
  return (
    <svg {...base} width={size} height={size} stroke="var(--amber)">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export function CheckIcon({ size = "1em" }: IconProps) {
  return (
    <svg {...base} width={size} height={size} stroke="var(--green)" strokeWidth={2.5}>
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  );
}

export function CarIcon({ size = "1em" }: IconProps) {
  return (
    <svg {...base} width={size} height={size} stroke="currentColor">
      <path d="M5 17h14l-1.5-6.5A2 2 0 0 0 15.6 9H8.4a2 2 0 0 0-1.9 1.5Z" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="16.5" cy="17.5" r="1.5" />
    </svg>
  );
}
