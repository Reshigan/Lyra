/**
 * Process flows, drawn from the two things that are already true: the state
 * machine a transaction is documented to follow (docs/19 §3) and the journal
 * lines it posted.
 *
 * Two components, one machine definition per flow, no diagram per screen
 * (CLAUDE.md §15). `StateFlow` renders where a thing is in its machine — what
 * happened, when, and what is still owed. `PostingFlow` renders value actually
 * moving: the legs on each side and the amount travelling between them.
 *
 * Three rules hold this file down:
 *
 *   1. It never computes money. Totals arrive from the ledger (`balanceCheck`);
 *      the only arithmetic here re-adds the legs on screen to check they say
 *      the same thing, and refuses to state a balance when they do not.
 *   2. It never invents a state. Anything not in the machine is reported as
 *      out-of-machine, never drawn as a step.
 *   3. Nothing is carried by movement. The one animation is a one-shot fade
 *      behind `motion-safe:` — no geometry moves, so a reduced-motion reader
 *      loses nothing and Playwright never waits for a box to settle.
 *
 * ponytail: semantic lists, not SVG. A pipeline is an ordered list of states
 * and a posting is two lists with a total — an `<ol>` is the diagram *and* its
 * own text equivalent, so there is no aria-hidden picture plus a duplicate
 * table to keep in sync. Reach for SVG when a flow needs to fork visually
 * (the money map already does, in apps/web).
 */
import * as React from "react";
import { cn } from "./cn.js";
import { DateTime, Money } from "./format.js";
import { Badge, type BadgeTone } from "./primitives.js";
import { useUiText } from "./text.js";

/* -------------------------------------------------------------------------- */
/* The machine                                                                 */
/* -------------------------------------------------------------------------- */

export interface FlowMachine {
  /** The documented machine: state → the states it may go to. Its keys are the
   *  only vocabulary this component will draw. */
  transitions: Readonly<Record<string, readonly string[]>>;
  /** The path through it when nothing goes wrong, in order. Every consecutive
   *  pair must be a documented transition — `flowPlan` throws if it is not. */
  spine: readonly string[];
  /** How the machine fails rather than continues (docs/19 §3 draws these going
   *  down: failed, rejected, expired). Excluded from "what is pending", so a
   *  live transaction is not told it is pending failure. */
  exits?: readonly string[];
}

export interface FlowVisit {
  state: string;
  at?: Date | string | number | null;
  actor?: string | null;
  detail?: string | null;
  /** The state's own hue, when the app has one (a failure is not a success). */
  tone?: BadgeTone;
}

export type FlowStatus = "done" | "current" | "pending";

export interface FlowStep extends Omit<FlowVisit, "state"> {
  state: string;
  status: FlowStatus;
}

export interface FlowPlan {
  steps: FlowStep[];
  /** States the data claimed that the machine does not document. */
  unknown: string[];
}

function assertSpine(machine: FlowMachine): void {
  machine.spine.forEach((state, i) => {
    if (!(state in machine.transitions)) {
      throw new TypeError(`flow: "${state}" is on the spine but not in the machine`);
    }
    const next = machine.spine[i + 1];
    if (next && !(machine.transitions[state] ?? []).includes(next)) {
      throw new TypeError(`flow: "${state}" -> "${next}" is not a documented transition`);
    }
  });
}

/**
 * History as it happened, then the current state, then what the machine says is
 * still to come. Visits are not deduped — a transaction that went out to a
 * provider and came back was in `executing` twice, and the flow says so.
 *
 * A spine that does not exist in the machine is a programming error in a
 * literal, so it throws. A *visited* state the machine does not know is runtime
 * drift, so it is reported and dropped: the diagram stays honest either way.
 */
export function flowPlan(
  machine: FlowMachine,
  visits: readonly FlowVisit[],
  current: string
): FlowPlan {
  assertSpine(machine);
  const unknown: string[] = [];
  const note = (state: string) => {
    if (!unknown.includes(state)) unknown.push(state);
  };

  const steps: FlowStep[] = [];
  for (const visit of visits) {
    if (!(visit.state in machine.transitions)) {
      note(visit.state);
      continue;
    }
    steps.push({ ...visit, status: "done" });
  }

  const known = current in machine.transitions;
  if (!known) note(current);
  const last = steps[steps.length - 1];
  if (known) {
    if (last && last.state === current) last.status = "current";
    else steps.push({ state: current, status: "current" });
  }

  // On the spine: the rest of the happy path. Off it (pending_external,
  // reversing, adjusting): whatever the machine documents next, minus the
  // failure branch. Terminal: nothing — and no invented "complete".
  const onSpine = known ? machine.spine.indexOf(current) : -1;
  const pending =
    onSpine >= 0
      ? machine.spine.slice(onSpine + 1)
      : known
        ? (machine.transitions[current] ?? []).filter(
            (state) => !(machine.exits ?? []).includes(state)
          )
        : [];
  for (const state of pending) steps.push({ state, status: "pending" });

  return { steps, unknown };
}

/* -------------------------------------------------------------------------- */
/* StateFlow                                                                   */
/* -------------------------------------------------------------------------- */

export interface StateFlowProps {
  machine: FlowMachine;
  visits: readonly FlowVisit[];
  /** The state the thing is in now, as the API reports it. */
  current: string;
  /** Accessible name for the pipeline — the app's words, not the kit's. */
  label: string;
  /** State id → the reader's word for it. The kit cannot translate app states. */
  labelFor: (state: string) => string;
  locale?: string;
  timeZone?: string;
  className?: string;
}

const STEP_TONE: Record<FlowStatus, BadgeTone> = {
  done: "success",
  current: "accent",
  pending: "neutral"
};

/** Where something is in its machine: past with timestamps, present, pending. */
export function StateFlow({
  machine,
  visits,
  current,
  label,
  labelFor,
  locale,
  timeZone,
  className
}: StateFlowProps) {
  const t = useUiText();
  const plan = flowPlan(machine, visits, current);
  const word: Record<FlowStatus, string> = {
    done: t("done"),
    current: t("flowNow"),
    pending: t("waiting")
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ol aria-label={label} className="flex flex-wrap items-stretch gap-2">
        {plan.steps.map((step, i) => (
          <li
            key={`${step.state}-${i}`}
            className="flex items-center gap-2"
            {...(step.status === "current" ? { "aria-current": "step" as const } : {})}
          >
            <div
              className={cn(
                "flex min-w-0 flex-col gap-1 rounded-md border p-3 motion-safe:animate-fade",
                step.status === "current"
                  ? "border-accent-line bg-surface-2"
                  : step.status === "pending"
                    ? "border-dashed border-line bg-transparent"
                    : "border-line bg-surface-2"
              )}
            >
              <span className="font-ui text-13 text-text">{labelFor(step.state)}</span>
              <Badge tone={step.tone ?? STEP_TONE[step.status]} size="sm" dot>
                {word[step.status]}
              </Badge>
              {step.at != null ? (
                <DateTime
                  value={step.at}
                  precision="minute"
                  className="font-mono text-12 text-subtle"
                  {...(locale ? { locale } : {})}
                  {...(timeZone ? { timeZone } : {})}
                />
              ) : null}
              {step.actor ? <span className="font-mono text-12 text-subtle">{step.actor}</span> : null}
              {step.detail ? (
                <span className="max-w-prose font-ui text-12 text-muted">{step.detail}</span>
              ) : null}
            </div>
            {/* The rail between steps. Order is already carried by the list. */}
            {i < plan.steps.length - 1 ? (
              <span aria-hidden="true" className="h-px w-4 shrink-0 bg-line" />
            ) : null}
          </li>
        ))}
      </ol>
      {plan.unknown.length > 0 ? (
        <p role="alert" className="font-ui text-12 text-danger">
          {t("outOfMachine", { states: plan.unknown.join(", ") })}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PostingFlow                                                                 */
/* -------------------------------------------------------------------------- */

export interface FlowLeg {
  id: string;
  /** Account code, or another stable name for where the value sits. */
  account: string;
  /** The account's name, translated by the caller. */
  label?: string;
  memo?: string | null;
  /** `"debit"` / `"credit"` as the ledger stores them. Anything else is a
   *  discrepancy, exactly as `balanceCheck` treats it — it belongs to neither
   *  total, so the flow refuses to call itself balanced. */
  side: string;
  amountMinor: number;
  /** Posted and immutable: gets the seal docs/19 §10 asks to make visible. */
  sealed?: boolean;
}

export interface FlowBalance {
  debitMinor: number;
  creditMinor: number;
  deltaMinor: number;
  balanced: boolean;
}

export interface PostingFlowProps {
  legs: readonly FlowLeg[];
  currency: string;
  /** The ledger's own totals (`balanceCheck` over the posted lines). */
  balance: FlowBalance;
  /** Defaults to "Debits"/"Credits"; overridden when the flow is not a posting
   *  (a settlement moves gross and adjustments into a net payable). */
  fromLabel?: string;
  toLabel?: string;
  /** Accessible name for the whole figure. */
  label?: string;
  /** What a reader should do about a discrepancy — the app's copy, not the
   *  kit's, shown under the verdict. */
  note?: React.ReactNode;
  locale?: string;
  className?: string;
}

/** Value moving: legs out, legs in, the amount between them, and the verdict. */
export function PostingFlow({
  legs,
  currency,
  balance,
  fromLabel,
  toLabel,
  label,
  note,
  locale,
  className
}: PostingFlowProps) {
  const t = useUiText();
  const debits = legs.filter((leg) => leg.side === "debit");
  const credits = legs.filter((leg) => leg.side === "credit");

  // Not the component's arithmetic — the ledger's, re-added to check the legs on
  // screen are the ones the totals came from. A figure that disagrees with the
  // lines beside it is the one thing a diagram must never smooth over
  // (docs/19 §11), so this only ever downgrades the verdict.
  const sum = (rows: readonly FlowLeg[]) => rows.reduce((n, leg) => n + leg.amountMinor, 0);
  const holds =
    balance.balanced &&
    debits.length + credits.length === legs.length &&
    sum(debits) === balance.debitMinor &&
    sum(credits) === balance.creditMinor;

  // Bar length is layout, not money: the amount is written beside it either way.
  const peak = Math.max(1, ...legs.map((leg) => Math.abs(leg.amountMinor)));
  const side = (rows: readonly FlowLeg[], name: string) => (
    <ol aria-label={name} className="flex min-w-0 flex-1 flex-col gap-2">
      {rows.map((leg) => (
        <li
          key={leg.id}
          className={cn(
            "flex flex-col gap-1 rounded-md border border-line bg-surface-2 p-3",
            // Immutability made visible rather than merely enforced.
            leg.sealed && "border-s-2 border-s-success"
          )}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="font-mono text-12 text-subtle">{leg.account}</span>
            <Money
              amountMinor={leg.amountMinor}
              currency={currency}
              className="font-mono text-13 text-text"
              {...(locale ? { locale } : {})}
            />
          </div>
          {leg.label ? <span className="font-ui text-12 text-text">{leg.label}</span> : null}
          {leg.memo ? <span className="font-ui text-12 text-muted">{leg.memo}</span> : null}
          <span aria-hidden="true" className="flex h-0.5 w-full bg-surface-3">
            <span
              className="h-full bg-accent motion-safe:animate-fade"
              style={{ inlineSize: `${(Math.abs(leg.amountMinor) / peak) * 100}%` }}
            />
          </span>
        </li>
      ))}
    </ol>
  );

  const from = fromLabel ?? t("debits");
  const to = toLabel ?? t("credits");

  return (
    <figure aria-label={label ?? t("valueFlow")} className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {side(debits, from)}
        {/* The amount on the wire between the two sides. Named again in the
            caption, so this is decoration — and it is a dash, never a figure,
            when the sides do not agree about what moved. */}
        <p
          aria-hidden="true"
          className="flex items-center gap-2 self-center font-mono text-13 text-subtle"
        >
          <span className="h-px w-6 bg-line" />
          {holds ? (
            <Money amountMinor={balance.debitMinor} currency={currency} {...(locale ? { locale } : {})} />
          ) : (
            "—"
          )}
          <span className="h-px w-6 bg-line" />
        </p>
        {side(credits, to)}
      </div>
      <figcaption className="flex flex-col gap-1">
        <span className="flex flex-wrap items-baseline gap-4 font-ui text-13 text-subtle">
          <span>
            {from}{" "}
            <Money
              amountMinor={balance.debitMinor}
              currency={currency}
              className="text-text"
              {...(locale ? { locale } : {})}
            />
          </span>
          <span>
            {to}{" "}
            <Money
              amountMinor={balance.creditMinor}
              currency={currency}
              className="text-text"
              {...(locale ? { locale } : {})}
            />
          </span>
        </span>
        {holds ? (
          <span className="font-ui text-13 text-success">{t("balanced")}</span>
        ) : (
          <span role="alert" className="flex flex-col gap-1">
            <span className="font-ui text-13 text-danger">{t("unbalanced")}</span>
            <Money
              amountMinor={balance.deltaMinor}
              currency={currency}
              signed
              className="font-mono text-22 text-danger"
              {...(locale ? { locale } : {})}
            />
            {note ? <span className="max-w-prose font-ui text-12 text-muted">{note}</span> : null}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
