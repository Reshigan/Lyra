import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { KPIWall, Stat, cn, focusRing, type StatProps } from "@lyra/ui";

// The figure at the top of a screen is the one number a person reads before
// deciding what to do, and the only honest answer to "why that number?" is the
// rows it counted. So a hero figure is a door: click it and the screen lists
// exactly the rows behind it — not a similar list, the same ones.
//
// "Exactly" is the whole point, and it is why the drill-down is a lens over the
// array the figure was counted from rather than a second query. A hero that
// says 412 and opens a list of 380 has taught the reader to distrust every
// figure on the platform; two reads of the same table at two moments, or one
// capped page against an uncapped one, are enough to do that. `lensOf` counts
// and lists through one predicate over one array, so the two cannot disagree.
//
// A figure with no rows to show (a rate, a median, a scalar off a config) gets
// no `to` and renders as plain text: docs/07 §3's rule that a closed door is
// absent rather than disabled applies to a door that was never there either.

/** The search param every hero drills through. One name across every screen. */
export const FOCUS = "focus";

/** A named subset of a screen's rows: what one hero figure counted. */
export type Lens<T> = (row: T) => boolean;

/**
 * The rows a hero figure stands for. Call it once for the figure and once for
 * the list and both come out of the same predicate over the same array — which
 * is what makes the drill-down accurate rather than merely plausible. An
 * unknown or absent `focus` is the whole set, so a hand-typed `?focus=nonsense`
 * degrades to the unfiltered screen instead of an empty one.
 */
export function lensOf<T>(rows: T[], lenses: Record<string, Lens<T>>, focus: string | null): T[] {
  const lens = focus === null ? undefined : lenses[focus];
  return lens ? rows.filter(lens) : rows;
}

/** The `?focus=` value in play, or null. Unknown values read as null (`lensOf`). */
export function focusIn(params: URLSearchParams, lenses: Record<string, unknown>): string | null {
  const focus = params.get(FOCUS);
  return focus !== null && focus in lenses ? focus : null;
}

/**
 * The active lens plus the hrefs its siblings need. `href` rewrites only
 * `?focus=` and keeps the rest of the query — a desk that was already narrowed
 * by `?show=all` or `?days=90` must not silently widen because a hero was
 * clicked. `href(null)` is the way back to the whole set.
 *
 * Only the lens *names* are needed, never the predicates, so a screen with two
 * lens families over different row types (cases and the bids under them) passes
 * both maps spread into one.
 */
export function useFocus(lenses: Record<string, unknown>): {
  focus: string | null;
  href: (lens: string | null) => string;
} {
  const [params] = useSearchParams();
  const next = (lens: string | null) => {
    const query = new URLSearchParams(params);
    if (lens === null) query.delete(FOCUS);
    else query.set(FOCUS, lens);
    const search = query.toString();
    return search ? `?${search}` : "?";
  };
  return { focus: focusIn(params, lenses), href: next };
}

export interface HeroStatProps extends StatProps {
  /**
   * Where this figure's own rows live — a `?focus=` on this screen, or a
   * filtered list route. Omit it and the figure is not a door and does not
   * pretend to be one.
   */
  to?: string;
  /** True when this figure's lens is the one the screen is currently filtered by. */
  active?: boolean;
}

export function HeroStat({ to, active = false, className, ...stat }: HeroStatProps) {
  // Spread rather than pass `className={className}`: under
  // exactOptionalPropertyTypes an explicit `undefined` is not the same as absent.
  if (to === undefined) return <Stat {...stat} {...(className === undefined ? {} : { className })} />;
  return (
    // A real link, so it is in the tab order, opens in a new tab on the usual
    // modifier, and reads to a screen reader as "<label> <value>, link" without
    // a second aria-label restating the tile.
    <Link
      to={to}
      aria-current={active ? "true" : undefined}
      className={cn(
        "-m-2 flex rounded-md border p-2 transition-colors duration-150 hover:border-border hover:bg-surface-2",
        active ? "border-accent/40 bg-accent/5" : "border-transparent",
        focusRing,
        className
      )}
    >
      <Stat {...stat} />
    </Link>
  );
}

export interface HeroWallProps {
  /** The active lens, or null. Drives the "show everything" way back out. */
  focus: string | null;
  /** Caller's own i18n for "show everything" — this file holds no copy. */
  allLabel: string;
  children: ReactNode;
}

/**
 * The wall of hero figures plus, once one of them has filtered the screen, the
 * way back to all of it. Without that link a drilled-in screen is just a screen
 * showing fewer rows than the reader expects, with nothing saying why.
 */
export function HeroWall({ focus, allLabel, children }: HeroWallProps) {
  // Empty lens map: this only needs the href builder, never the active lens —
  // the caller already knows which one that is and passes it as `focus`.
  const { href } = useFocus({});
  return (
    <div className="flex flex-col gap-3">
      <KPIWall>{children}</KPIWall>
      {focus ? (
        <Link
          to={href(null)}
          className={cn("w-fit font-ui text-13 text-accent underline underline-offset-2", focusRing)}
        >
          {allLabel}
        </Link>
      ) : null}
    </div>
  );
}
