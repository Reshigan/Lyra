import { Link } from "react-router";
import { Money } from "@lyra/ui";
import type { Posture } from "./shift";

// The two chips the Horizon comp puts in the top bar beside the theme toggle:
// how much client money the tenant is holding, and whether this month's ledger
// is still open. Both are facts, not decoration — a broker who cannot see the
// client-money position without opening a report will not look at it.

export type T = (key: string, vars?: Record<string, string>) => string;

const CHIP =
  "hidden items-center gap-1.5 rounded-orbit border border-border px-2 py-0.5 font-mono text-12 text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:inline-flex";

/**
 * Absent, not empty: a caller without `ledger:client_money:read` gets no money
 * chip at all rather than a chip reading "—", which is the same rule the nav
 * follows for a workspace someone may not open.
 */
export function PostureChips({ posture, t }: { posture: Posture | null | undefined; t: T }) {
  if (!posture) return null;
  const money = posture.clientMoney;
  const period = posture.period;

  return (
    <>
      {money ? (
        // The statement for 1010 is where the number is explained, so the chip
        // is the door to it rather than a tooltip about it.
        <Link
          to="/ledger/statement?account=1010"
          className={CHIP}
          title={t("header.clientMoney")}
          data-breach={money.breach ? "true" : undefined}
        >
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${money.breach ? "bg-danger" : "bg-success"}`}
          />
          <span className="sr-only">{t("header.clientMoney")}</span>
          <Money amountMinor={money.heldMinor} currency={money.currency} />
        </Link>
      ) : null}

      {period ? (
        <Link to="/ledger/period-close" className={CHIP} title={t("header.period")}>
          <span className="sr-only">{t("header.period")}</span>
          <span>{period.code}</span>
          <span className={period.state === "open" ? "text-subtle" : "text-success"}>
            {t(`period.${period.state}`)}
          </span>
        </Link>
      ) : null}
    </>
  );
}
