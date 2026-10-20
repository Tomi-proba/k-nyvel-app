import { useState } from "react";
import { readSetting, writeSetting } from "../lib/storage";
import { Tooltip } from "../ui/Tooltip";

type Theme = "system" | "light" | "dark";
const LABELS: Record<Theme, string> = { system: "Rendszer szerint", light: "Világos", dark: "Sötét" };
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

function apply(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** Világos / sötét / rendszer szerinti téma váltása. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = readSetting("theme");
    return t === "light" || t === "dark" ? t : "system";
  });
  const next = NEXT[theme];
  return (
    <Tooltip content={`Téma: ${LABELS[theme]}. Kattintson a váltáshoz (${LABELS[next]}).`}>
      <button
        type="button"
        className="btn btn-icon"
        aria-label={`Téma: ${LABELS[theme]}. Váltás erre: ${LABELS[next]}`}
        onClick={() => {
          setTheme(next);
          writeSetting("theme", next === "system" ? null : next);
          apply(next);
        }}
      >
        <ThemeIcon theme={theme} />
      </button>
    </Tooltip>
  );
}

/** Egyszerű SVG ikonok (betűkészlettől függetlenül jelennek meg). */
function ThemeIcon({ theme }: { theme: Theme }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true } as const;
  if (theme === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg {...common}>
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" />
    </svg>
  );
}
