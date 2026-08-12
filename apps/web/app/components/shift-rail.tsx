import { NavLink } from "react-router";
import { DateTime } from "@lyra/ui";
import { RING_CIRCUMFERENCE, type Shift } from "./shift";
import type { Translate } from "../i18n";

const MODULE_HUE: Record<string, string> = {
  axis: "var(--module-axis)",
  orbit: "var(--module-orbit)",
  signal: "var(--module-signal)",
  scout: "var(--module-scout)",
  north: "var(--module-north)"
};

/**
 * The top of the rail: what today asks of this actor, in the order it arrived,
 * over a ring saying how much of it is behind them. The comp puts this where a
 * nav menu would be — it has no nav menu at all, only the search overlay — but
 * the destinations still have to be reachable, so the shift sits above the nav
 * groups rather than replacing them.
 *
 * Renders nothing when the inbox could not be read: a rail that says "0 of 0"
 * because a fetch failed is a lie, and an absent block is not.
 */
export function ShiftRail({ t, shift }: { t: Translate; shift: Shift | null }) {
  if (!shift) return null;

  return (
    <div className="mb-2 border-b border-border pb-2">
      <div className="flex items-center gap-[11px] px-1 pb-3">
        <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true" className="shrink-0">
          <circle cx="19" cy="19" r="16" fill="none" stroke="var(--surface-3)" strokeWidth="3" />
          <circle
            cx="19"
            cy="19"
            r="16"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeDasharray={shift.dash}
            strokeLinecap="round"
            transform="rotate(-90 19 19)"
            pathLength={RING_CIRCUMFERENCE}
          />
        </svg>
        <div className="min-w-0">
          <h2 className="mb-[3px] font-ui text-12 font-medium uppercase tracking-[0.14em] text-subtle">
            {t("shift.title")}
          </h2>
          <p className="font-mono text-12 text-text">
            {t("shift.cleared", { done: String(shift.done), total: String(shift.done + shift.open) })}
          </p>
          <p className="mt-0.5 text-12 text-subtle">
            {shift.open ? t("shift.left", { count: String(shift.open) }) : t("shift.clear")}
          </p>
        </div>
      </div>

      {shift.items.length ? (
        <ul className="flex flex-col">
          {shift.items.map((item) => (
            <li key={item.id}>
              <NavLink
                to="/approvals"
                className="relative block rounded-md py-2 pe-2 ps-3 transition-colors duration-150 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {/* The same 2px hue the workspace and the nav's current item
                    carry, so a queue item says which module it comes from
                    before its words are read. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1 start-0 w-0.5 rounded-full"
                  style={{ background: MODULE_HUE[item.module] ?? "var(--accent)" }}
                />
                <span className="mb-[5px] flex items-center gap-2">
                  <span aria-hidden="true" className="font-mono text-12 text-subtle">
                    {item.ordinal}
                  </span>
                  <span
                    className="font-ui text-12 uppercase tracking-[0.1em]"
                    style={{ color: MODULE_HUE[item.module] ?? "var(--accent)" }}
                  >
                    {item.module}
                  </span>
                  <span className="ms-auto font-mono text-12 text-subtle">
                    <DateTime value={item.at} precision="time" />
                  </span>
                </span>
                <span className="block text-13 leading-snug text-text">{item.title}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
