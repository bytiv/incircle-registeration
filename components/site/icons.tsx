/**
 * The page's few icons, drawn in one hand: 24-unit boxes, round caps, 2px strokes in the text's
 * own colour. Decorative everywhere they are used (the words beside them say what they mean).
 */

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function Arrow({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function Chevron({ className, dir }: IconProps & { dir: "left" | "right" }) {
  return (
    <svg {...base} className={className} strokeWidth={2.2}>
      <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

export function Check({ className }: IconProps) {
  return (
    <svg {...base} className={className} strokeWidth={2.6}>
      <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>
  );
}

export function Close({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function Person({ className }: IconProps) {
  return (
    <svg {...base} className={className} strokeWidth={1.8}>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M4.8 20c1.3-3.6 4-5.4 7.2-5.4s5.9 1.8 7.2 5.4" />
    </svg>
  );
}

export function Calendar({ className }: IconProps) {
  return (
    <svg {...base} className={className} strokeWidth={1.8}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </svg>
  );
}
