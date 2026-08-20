/**
 * The one interactive hero every screen renders above `sections[]` (not part
 * of the design file — see docs header in ./types.ts). A screen with no
 * `hero` data still renders: eyebrow, title, attn and sub degrade gracefully
 * on their own, the headline figure/trend/chips are additive.
 *
 * Four real behaviours, not decoration pretending to be interactive:
 *   - the headline figure counts up from zero once, on mount
 *   - the trend strip is scrubbable by pointer and by arrow key
 *   - each chip reveals its `detail` on hover/focus, and stays open on tap
 *   - a chip row past three items drills in behind a real expand toggle
 */
import * as React from "react";
import { cn } from "../cn.js";
import { Eyebrow, Lede, hueVar } from "../horizon.js";
import { asLyraModule } from "./shared.js";
import type { HeroChip, HeroData, ScreenModule, SparkItem } from "./types.js";

const VISIBLE_CHIPS = 3;

/**
 * Splits a headline value into prefix / numeral / suffix — "AED 4.2m" into
 * "AED ", "4.2", "m".
 *
 * The prefix class excludes ',' as well as digits. The obvious `\D*` overlaps
 * the group after it on every comma, so a value of nothing but commas makes the
 * two groups fight over the same characters — polynomial backtracking, which is
 * a hero `value` a tenant can supply (CodeQL js/polynomial-redos). No currency
 * or unit prefix contains a comma, so the narrower class costs nothing.
 *
 * Exported for the test: the hook that uses it only runs in an effect, which
 * server rendering never reaches.
 */
export const HEADLINE_NUMERAL = /^([^\d,]*)([\d,]+(?:\.\d+)?)(.*)$/;

/**
 * Animates a display string from 0 up to the numeral inside `target`, once,
 * on mount or whenever `target` itself changes. Values with no parseable
 * leading numeral (or a browser that prefers reduced motion) render as-is —
 * there is nothing to count through and nothing worth forcing.
 */
function useCountUp(target: string, durationMs = 700): string {
  const [display, setDisplay] = React.useState(target);
  React.useEffect(() => {
    const match = HEADLINE_NUMERAL.exec(target);
    if (!match) {
      setDisplay(target);
      return;
    }
    const [, prefix, numStr, suffix] = match;
    // `noUncheckedIndexedAccess` types every destructured group as possibly
    // `undefined` even though the pattern's second group is mandatory
    // whenever `match` succeeds at all — so this narrows rather than asserts.
    if (!numStr) {
      setDisplay(target);
      return;
    }
    const value = Number(numStr.replace(/,/g, ""));
    if (!Number.isFinite(value)) {
      setDisplay(target);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(target);
      return;
    }
    const decimals = numStr.includes(".") ? (numStr.split(".")[1]?.length ?? 0) : 0;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const formatted = (value * eased).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
      setDisplay(`${prefix}${formatted}${suffix}`);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return display;
}

/** A scrubbable trend strip: pointer move and ArrowLeft/ArrowRight both move
 * a reading cursor that surfaces one point's literal label in a tooltip and
 * an `aria-live` line, without claiming the "set a value" semantics of a
 * true slider — this only lets a person inspect, never adjust, the series. */
function Trend({ items }: { items: SparkItem[] }) {
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const active = hoverIndex !== null ? items[hoverIndex] : null;

  const indexFromClientX = (clientX: number): number | null => {
    const el = trackRef.current;
    if (!el || items.length === 0) return null;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * (items.length - 1));
  };

  return (
    <div
      ref={trackRef}
      tabIndex={0}
      role="group"
      aria-label="Trend — hover or use the arrow keys to inspect a point"
      className="relative flex h-16 items-end gap-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onMouseMove={(event) => setHoverIndex(indexFromClientX(event.clientX))}
      onMouseLeave={() => setHoverIndex(null)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setHoverIndex((i) => Math.max(0, (i ?? items.length - 1) - 1));
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          setHoverIndex((i) => Math.min(items.length - 1, (i ?? 0) + 1));
        }
      }}
    >
      {items.map((item, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cn(
            "min-w-0.5 flex-1 rounded-t-sm transition-opacity duration-150 ease-out",
            hoverIndex !== null && hoverIndex !== i ? "opacity-40" : "opacity-100"
          )}
          style={{ height: item.h, background: item.hue }}
        />
      ))}
      {active ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-sm border border-line2 bg-surface-3 px-2 py-1 font-mono text-12 text-fg shadow-elev"
          style={{ insetInlineStart: `${(hoverIndex! / Math.max(1, items.length - 1)) * 100}%` }}
        >
          {active.label}
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {active ? `Point ${hoverIndex! + 1} of ${items.length}: ${active.label}` : ""}
      </span>
    </div>
  );
}

/** One KPI chip. The whole chip is a real button (keyboard reachable, a real
 * `onClick`) so hovering, focusing or tapping all reveal `detail` the same
 * way — never a `role`/`tabIndex` promising an action nothing implements. */
function Chip({ chip }: { chip: HeroChip }) {
  const [pinned, setPinned] = React.useState(false);
  const display = useCountUp(chip.value);
  return (
    <button
      type="button"
      aria-expanded={chip.detail ? pinned : undefined}
      onClick={() => {
        if (chip.detail) setPinned((v) => !v);
      }}
      className={cn(
        "group flex min-w-[9rem] flex-col gap-1 rounded-md border border-border bg-surface-2 px-4 py-3 text-start shadow-elev transition-colors duration-150 ease-out hover:border-accent-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        pinned && "border-accent-line"
      )}
    >
      <span className="text-12 uppercase tracking-wide text-subtle">{chip.label}</span>
      <span className="font-mono text-22 font-medium tabular-nums" style={{ color: chip.hue }}>
        {display}
      </span>
      {chip.detail ? (
        <span
          className={cn(
            "grid text-12 leading-relaxed text-subtle transition-[grid-template-rows] duration-200 ease-out",
            pinned
              ? "grid-rows-[1fr] pt-1 opacity-100"
              : "grid-rows-[0fr] opacity-0 group-hover:grid-rows-[1fr] group-hover:pt-1 group-hover:opacity-100"
          )}
        >
          <span className="overflow-hidden">{chip.detail}</span>
        </span>
      ) : null}
    </button>
  );
}

/** Chips past the first three sit behind a real expand toggle — the "drill
 * in" behaviour — rather than a wall of chips every screen has to scan. */
function ChipRow({ chips }: { chips: HeroChip[] }) {
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded ? chips : chips.slice(0, VISIBLE_CHIPS);
  const hiddenCount = chips.length - VISIBLE_CHIPS;
  return (
    <div className="flex flex-wrap items-stretch gap-3">
      {visible.map((chip, i) => (
        <Chip key={i} chip={chip} />
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-[6rem] items-center justify-center rounded-md border border-dashed border-line3 px-4 py-3 text-12 text-subtle transition-colors duration-150 ease-out hover:border-accent-line hover:text-accent"
        >
          {expanded ? "Show fewer" : `+${hiddenCount} more`}
        </button>
      ) : null}
    </div>
  );
}

export interface HeroProps {
  eyebrow: string;
  title: string;
  attn?: string;
  sub?: string;
  mod: ScreenModule;
  hero?: HeroData;
}

export function Hero({ eyebrow, title, attn, sub, mod, hero }: HeroProps) {
  const module = asLyraModule(mod);
  const [headline, ...restChips] = hero?.chips ?? [];
  const headlineDisplay = useCountUp(headline?.value ?? "");

  return (
    <section className="relative flex flex-col gap-5 overflow-hidden rounded-lg border border-border bg-surface-1 p-6 shadow-elev">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ background: hueVar(module) }} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Eyebrow module={module}>{eyebrow}</Eyebrow>
          <Lede>{title}</Lede>
          {sub ? <p className="max-w-[60ch] text-14 leading-relaxed text-subtle">{sub}</p> : null}
        </div>
        {attn ? (
          <span className="shrink-0 rounded-orbit border border-accent-line bg-accent-soft px-3 py-1 text-12 text-accent">
            {attn}
          </span>
        ) : null}
      </div>
      {headline ? (
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono text-48 font-medium tabular-nums motion-safe:animate-rise"
            style={{ color: headline.hue }}
          >
            {headlineDisplay}
          </span>
          <span className="text-13 text-subtle">{headline.label}</span>
        </div>
      ) : null}
      {hero?.trend && hero.trend.length > 0 ? <Trend items={hero.trend} /> : null}
      {restChips.length > 0 ? <ChipRow chips={restChips} /> : null}
    </section>
  );
}
