import { useEffect, useState } from "react";
import type { Translate } from "../i18n";

// The document carries `data-theme`; root.tsx sets it from the `lyra_theme`
// cookie so the first paint is already the right palette, and this button flips
// the attribute and the cookie together. Nothing else in the app reads a theme:
// every surface is tokens, and the two palettes are two token blocks.
//
// ponytail: a cookie and one attribute. No context, no provider, no store — the
// only reader is CSS.

type Theme = "dark" | "light";

/** What the page is showing right now, override or OS preference. */
function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "dark" || set === "light") return set;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeToggle({ t }: { t: Translate }) {
  // There is no `document` on the server, so the first render commits to
  // nothing and the effect names the theme after hydration — the alternative is
  // a server/client mismatch on the glyph.
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(currentTheme()), []);

  const label = theme === "light" ? t("header.themeDark") : t("header.themeLight");

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        const next: Theme = currentTheme() === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        // A year, path-wide, lax: the same shape settings.tsx writes for
        // `lyra_locale`. Readable by script on purpose — this one is a
        // preference, not a credential.
        document.cookie = `lyra_theme=${next};path=/;max-age=31536000;samesite=lax`;
        setTheme(next);
      }}
      className="grid size-8 shrink-0 place-items-center rounded-md text-13 text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {/* The glyph names the current sky, not the destination; the accessible
          name names the destination. */}
      <span aria-hidden="true">{theme === "light" ? "☀" : "☾"}</span>
    </button>
  );
}
