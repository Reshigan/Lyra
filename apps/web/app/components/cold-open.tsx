import { useEffect, useState } from "react";
import { ConstellationMark } from "./mark";

/**
 * The cold open (ADR-0055): the field holds for a beat, the constellation
 * draws, the wordmark settles, and the veil lifts off a workspace that was
 * already there. Decoration that never holds the door — `pointer-events:
 * none`, `aria-hidden`, and gone the moment its own animation ends.
 */

/** The sitting is marked in sessionStorage, not a cookie: a purely local,
 *  purely visual fact has no business on every request. */
const MARK = "lyra_opened";

/** Two of the three gates in ADR-0055 — the third (has the document hydrated)
 *  is structural: the component mounts in an effect and so cannot be true on
 *  the server. Pure, so the rule is tested rather than eyeballed. */
export function coldOpenAllowed({ reduced, opened }: { reduced: boolean; opened: boolean }): boolean {
  return !reduced && !opened;
}

export function ColdOpen({ name }: { name: string }) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Private browsing and locked-down storage policies throw on access rather
    // than returning null. An unreadable mark means "assume it has opened":
    // skipping decoration is always the safe failure.
    let opened = true;
    try {
      opened = window.sessionStorage.getItem(MARK) !== null;
    } catch {
      opened = true;
    }
    if (!coldOpenAllowed({ reduced, opened })) return;
    try {
      window.sessionStorage.setItem(MARK, "1");
    } catch {
      // Nothing to do: the open plays this once and simply plays again next
      // navigation in a browser that refuses to remember. Still not a modal.
    }
    setPlaying(true);
  }, []);

  if (!playing) return null;

  return (
    <div
      className="lyra-cold-open"
      aria-hidden="true"
      // Children animate too and animationend bubbles, so the veil listens for
      // its own animation only — otherwise the mark's 900ms draw would tear the
      // overlay away mid-open.
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setPlaying(false);
      }}
    >
      <div className="flex items-center gap-5">
        <ConstellationMark className="h-[124px] w-[132px]" />
        <span data-part="wordmark" className="font-display text-36 tracking-tight text-text">
          {name}
        </span>
      </div>
    </div>
  );
}
