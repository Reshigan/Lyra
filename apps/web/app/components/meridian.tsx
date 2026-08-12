import * as React from "react";
import { DateTime } from "@lyra/ui";
import { dayEvents, dayFraction, type Inbox } from "./shift";
import type { Translate } from "../i18n";

/**
 * The day strip that opens the Horizon shell: one line for today, ticked by the
 * hour, with a dot where each thing landed and a playhead at now. Read-only on
 * purpose — the comp's caption offered "drag — replay left, project right", and
 * a scrubber that pretends to time-travel is worse than none. What it says is
 * true: this is what has happened, and this is how far into it you are.
 *
 * Everything positioned from local time renders only after mount. A Worker
 * formats in UTC (packages/ui text.tsx UiTimeZoneProvider, which serves "UTC"
 * on the server pass and the browser's first pass before swapping to the
 * reader's zone), so a dot placed from local hours during SSR is a hydration
 * mismatch — which React 19 answers by throwing the whole route to the error
 * boundary.
 */
export function Meridian({ t, inbox, accent }: { t: Translate; inbox: Inbox | null; accent: string }) {
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    setNow(Date.now());
    // A playhead that only moves on navigation is a stopped clock. One tick a
    // minute is as fine as the strip can show — 42px carries no more.
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const events = now === null ? [] : dayEvents(inbox, now);
  const played = now === null ? 0 : dayFraction(now);

  return (
    <section
      aria-label={t("meridian.title")}
      className="hidden h-[74px] shrink-0 border-b border-border bg-surface-1 px-4 pt-2 md:block"
    >
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[9.5px] uppercase tracking-[0.16em] text-subtle">{t("meridian.title")}</span>
          <span className="font-mono text-[11.5px] text-text">
            {now === null ? null : <DateTime value={now} precision="time" />}
          </span>
        </div>
        <span className="text-[10px] text-subtle">
          {now === null ? null : t("meridian.landed", { count: String(events.length) })}
        </span>
      </div>

      <div className="relative h-[42px]">
        <div className="absolute inset-x-0 top-[21px] h-px bg-border-strongest" />
        {/* The sweep is the only motion here, and it carries nothing: the
            reduced-motion reset in tokens.css stops it without loss. */}
        <div
          className="pointer-events-none absolute start-0 top-5 h-[3px] w-[14%] opacity-50"
          style={{
            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            animation: "lyra-scan 9s linear infinite"
          }}
          aria-hidden="true"
        />
        {/* What has not happened yet, hatched rather than blank so the strip
            reads as a day and not as a half-loaded one. */}
        <div
          aria-hidden="true"
          className="absolute bottom-2 top-2 border-s border-dashed border-border-strong"
          style={{
            insetInlineStart: `${played * 100}%`,
            insetInlineEnd: 0,
            background:
              "repeating-linear-gradient(135deg, var(--surface-3) 0px, var(--surface-3) 3px, transparent 3px, transparent 7px)"
          }}
        />
        <div aria-hidden="true" className="absolute inset-x-0 top-[15px] flex h-[13px] items-stretch justify-between">
          {HOURS.map((hour) => (
            <div key={hour} className="w-px bg-border-strong" style={{ height: hour % 6 === 0 ? "13px" : "6px" }} />
          ))}
        </div>

        <ul className="contents">
          {events.map((event) => (
            <li
              key={event.id}
              className="pointer-events-none absolute top-0 -translate-x-1/2"
              style={{ insetInlineStart: `${dayFraction(event.at) * 100}%` }}
            >
              <div
                className="mx-auto size-[5px] rounded-full"
                style={{ background: hueFor(event.module, accent) }}
              />
              <div className="mx-auto h-[17px] w-px bg-border-strong" />
              <div className="mt-0.5 -translate-x-1/2 whitespace-nowrap font-mono text-[8.5px] text-subtle">
                {event.labelled ? <DateTime value={event.at} precision="time" /> : null}
              </div>
            </li>
          ))}
        </ul>

        {now === null ? null : (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-px"
            style={{ insetInlineStart: `${played * 100}%`, background: accent }}
          >
            <div
              className="absolute -top-0.5 size-[7px] rounded-full"
              style={{ insetInlineStart: "-3px", background: accent }}
            />
          </div>
        )}
      </div>
    </section>
  );
}

/** Midnight to midnight; every sixth tick is full height so the eye finds 06:00. */
const HOURS = Array.from({ length: 25 }, (_, i) => i);

const MODULE_HUE: Record<string, string> = {
  axis: "var(--module-axis)",
  orbit: "var(--module-orbit)",
  signal: "var(--module-signal)",
  scout: "var(--module-scout)",
  north: "var(--module-north)"
};

/** A dot the module owns takes the module's hue; anything else takes the tenant's. */
function hueFor(module: string, accent: string): string {
  return MODULE_HUE[module] ?? accent;
}
