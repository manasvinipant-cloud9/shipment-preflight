"use client";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/** Flip the theme with colour transitions off: flush styles with them disabled, change the theme, flush again, re-enable. */
function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  void root.offsetWidth;
  root.dataset.theme = t;
  void root.offsetWidth;
  root.classList.remove("theme-switching");
}

/** Light / dark switch. The inline script in layout.tsx sets data-theme before first paint; this keeps it in sync and saves the choice. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null); // null until mounted, so server and client markup match

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    // With no saved choice, follow the system setting live.
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      try { if (localStorage.getItem("theme")) return; } catch { /* storage blocked: follow the system */ }
      const t: Theme = mq.matches ? "light" : "dark";
      applyTheme(t);
      setTheme(t);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const next: Theme = theme === "light" ? "dark" : "light";
  function toggle() {
    applyTheme(next); // everything changes at once instead of fading piece by piece
    try { localStorage.setItem("theme", next); } catch { /* private mode: still applies for this visit */ }
    setTheme(next);
  }

  return (
    <button type="button" className="btn small theme-toggle" onClick={toggle}
      aria-label={theme ? `Switch to ${next} mode (currently ${theme})` : "Switch colour theme"} title={theme ? `Switch to ${next} mode` : "Switch colour theme"}>
      <span aria-hidden>{theme === "light" ? "☾" : "☀"}</span>
      <span className="tt-label">{theme ? (next === "light" ? "Light" : "Dark") : "Theme"}</span>
    </button>
  );
}
