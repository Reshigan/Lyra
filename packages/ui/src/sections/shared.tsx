/**
 * Shared helpers for the 22 section renderers (docs/superpowers's
 * revenue-lines Constellation import). Not itself one of the 22 kinds — this
 * is the one shared file every `*-section.tsx` reuses instead of repeating
 * the same panel chrome and hue/tone plumbing 22 times.
 */
import * as React from "react";
import { cn } from "../cn.js";
import { Eyebrow, Lede, hueVar } from "../horizon.js";
import type { LyraModule } from "../nav.js";
import type { BadgeTone } from "../primitives.js";
import type { ScreenModule } from "./types.js";

/** The five module ids `HueBar`/`Eyebrow`/`Panel` know how to tint. The other
 * eight `ScreenModule` ids (ledger, distribution, ...) render with the
 * neutral accent instead of inventing new module hues here — widening
 * `LyraModule` is a `packages/ui/src/nav.tsx` decision, not this build's. */
const SUPPORTED_MODULES = new Set<ScreenModule>(["axis", "orbit", "signal", "scout", "north"]);

export function asLyraModule(mod: ScreenModule): LyraModule | null {
  return SUPPORTED_MODULES.has(mod) ? (mod as LyraModule) : null;
}

/**
 * Reproduces the design file's own `tone(v)` word lists verbatim (status
 * word → good/bad/mid), so a literal status string like "Settled" or
 * "Rejected" gets the same tone here as it did in the design file, instead of
 * a re-guessed mapping.
 */
const GOOD_WORDS = new Set([
  "active", "paid", "settled", "collected", "confirmed", "completed", "approved", "closed", "bound",
  "live", "matched", "verified", "issued", "done", "passed", "published", "delivered", "accepted",
  "clean", "renewed", "proved", "read", "kept"
]);
const BAD_WORDS = new Set([
  "past due", "overdue", "failed", "charged back", "disputed", "blocked", "variance", "rejected",
  "lapsed", "cancelled", "urgent", "halted", "stale", "suspended", "lost", "stopped", "refused",
  "late", "unreadable", "twice now"
]);
const MID_WORDS = new Set([
  "running", "in review", "proposed", "pending", "scheduled", "draft", "paused", "due", "held",
  "quoting", "waiting on docs", "assessing", "reported", "reading", "flagged", "testing", "parked",
  "soft closed", "waiting", "offered", "open", "asking", "early days"
]);

export function toneFromWord(value: string): BadgeTone {
  const word = value.toLowerCase();
  if (GOOD_WORDS.has(word)) return "success";
  if (BAD_WORDS.has(word)) return "danger";
  if (MID_WORDS.has(word)) return "warning";
  return "neutral";
}

/** A `flex`/`min` pair from the design file's `half()` — applied verbatim as
 * inline style on a section's outer flex item. */
export interface HalfWidthStyle {
  // Explicit `| undefined`, not just `?:` — every caller passes a design-file
  // field straight through (`flex={section.flex}`) and that field's own type
  // is `string | undefined`, which `exactOptionalPropertyTypes` treats as
  // distinct from "may be omitted" unless the target says so too.
  flex?: string | undefined;
  min?: string | undefined;
}

export function halfWidthStyle({ flex, min }: HalfWidthStyle): React.CSSProperties {
  return { ...(flex ? { flex } : {}), ...(min ? { minWidth: min } : {}) };
}

export interface SectionShellProps extends HalfWidthStyle {
  title: string;
  mod: ScreenModule;
  children: React.ReactNode;
  className?: string;
}

/** The chrome every section shares: a hue bar for its module, an optional
 * eyebrow when the section carries its own title, then the kind-specific
 * body. Sections that set `title: ""` skip the eyebrow entirely rather than
 * rendering an empty one. */
export function SectionShell({ title, mod, flex, min, children, className }: SectionShellProps) {
  const module = asLyraModule(mod);
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-3 overflow-hidden rounded-md border border-border bg-surface-1 p-4 text-start",
        className
      )}
      style={halfWidthStyle({ flex, min })}
    >
      <div aria-hidden="true" className="h-0.5 w-full" style={{ background: hueVar(module) }} />
      {title ? <Eyebrow module={module}>{title}</Eyebrow> : null}
      {children}
    </section>
  );
}

/** A single design-file item's colour swatch, applied as literal inline
 * style — the `var(--x)` strings resolve against the aliases added to
 * tokens.css, so no per-item remap is needed. */
export function hueStyle(hue?: string): React.CSSProperties {
  return hue ? { color: hue } : {};
}

export function chipStyle(bg?: string, fg?: string, line?: string): React.CSSProperties {
  return {
    ...(bg ? { background: bg } : {}),
    ...(fg ? { color: fg } : {}),
    ...(line ? { borderColor: line } : {})
  };
}

/**
 * True once, one tick after mount. Lets a value-driven length (a bar's
 * width, a band's fill) transition in from zero on first paint instead of
 * snapping straight to its final state — the mount-only motion `docs/15 §3`
 * asks for elsewhere, reused here for the meter-shaped sections. A CSS
 * transition (paired with `motion-reduce:transition-none` at the call site)
 * does the animating, so this hook only ever flips a boolean.
 */
export function useMountAnimate(): boolean {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}

export { Lede };
