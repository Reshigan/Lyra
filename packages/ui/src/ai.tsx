/**
 * Ambient-AI surfaces — docs/07 §2 "AI-specific", docs/15 §4.
 *
 * Grammar: ghost text, quiet chips, background drafts. Never a modal, never an
 * auto-send. Every AI artifact carries the single ✦ marker (docs/01 §7: it is
 * the ONLY sparkle in the product) and an inspectable "why".
 */
import * as React from "react";
import { cn, focusRing } from "./cn.js";
import { Badge, Button, ProgressBar, type BadgeTone } from "./primitives.js";
import { Popover } from "./overlays.js";

/** The one and only ✦. */
export const AGENT_MARK = "✦";

export interface AgentBadgeProps {
  /** What produced this, e.g. "Renewal drafter". Shown as visible text. */
  agent?: string;
  /** Short explanation surfaced on demand — "why" is one interaction away. */
  why?: React.ReactNode;
  size?: "sm" | "md";
  className?: string;
}

export function AgentBadge({ agent, why, size = "sm", className }: AgentBadgeProps) {
  const chip = (
    <Badge tone="accent" size={size} className={className}>
      <span aria-hidden="true">{AGENT_MARK}</span>
      <span>{agent ? `Drafted by ${agent}` : "AI-generated"}</span>
    </Badge>
  );
  if (!why) return chip;
  return (
    <Popover
      label="Why this was drafted"
      trigger={
        <button type="button" className={cn("rounded-orbit", focusRing)}>
          {chip}
        </button>
      }
    >
      {why}
    </Popover>
  );
}

/**
 * Streamed AI draft rendered as ghost text the human can Tab-accept, edit or
 * discard (docs/07 §4). Announced politely; never committed on its own.
 */
export interface GhostTextProps {
  text: string;
  onAccept?: () => void;
  onDiscard?: () => void;
  className?: string;
}

export function GhostText({ text, onAccept, onDiscard, className }: GhostTextProps) {
  return (
    <span className={cn("inline", className)}>
      <span aria-live="polite" className="font-ui text-subtle">
        {text}
      </span>
      {onAccept || onDiscard ? (
        <span className="ms-2 inline-flex items-center gap-1 align-middle">
          {onAccept ? (
            <Button size="sm" variant="ghost" onClick={onAccept}>
              Accept <kbd className="font-mono text-11">Tab</kbd>
            </Button>
          ) : null}
          {onDiscard ? (
            <Button size="sm" variant="ghost" onClick={onDiscard}>
              Discard <kbd className="font-mono text-11">Esc</kbd>
            </Button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

export interface ConfidenceMeterProps {
  /** 0–1. */
  value: number;
  label?: string;
  /** Below this the UI should require review rather than offer acceptance. */
  floor?: number;
  className?: string;
}

export function ConfidenceMeter({
  value,
  label = "Model confidence",
  floor = 0.7,
  className
}: ConfidenceMeterProps) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tone: BadgeTone = value >= floor ? "success" : value >= floor - 0.2 ? "warning" : "danger";
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between gap-2 font-ui text-12 text-subtle">
        <span>{label}</span>
        <span className="tabular-nums text-muted">{pct}%</span>
      </div>
      <ProgressBar value={pct} tone={tone} label={`${label}: ${pct} percent`} />
    </div>
  );
}

export interface EvidenceLinkProps extends Omit<React.ComponentPropsWithRef<"button">, "children"> {
  /** The claim text the reader sees. */
  children: React.ReactNode;
  /** Source detail shown in the popover: document, span, timestamp. */
  source: React.ReactNode;
  sourceLabel?: string;
}

/** Claim → source. Dotted-underline vega, per docs/07 §4 (The Brief). */
export function EvidenceLink({
  children,
  source,
  sourceLabel = "Evidence",
  className,
  ...props
}: EvidenceLinkProps) {
  return (
    <Popover
      label={sourceLabel}
      trigger={
        <button
          {...props}
          type="button"
          className={cn(
            "border-b border-dotted border-accent-hover text-accent",
            focusRing,
            className
          )}
        >
          {children}
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <span className="font-ui text-11 uppercase tracking-wider text-subtle">{sourceLabel}</span>
        {source}
      </div>
    </Popover>
  );
}

export interface GuardrailNoticeProps {
  /** What the gate is. Gates are always shown with their reason (docs/22 §5.4). */
  title: string;
  /** Why it fired — quote the specific rule, never a generic message. */
  reason: React.ReactNode;
  tone?: "warning" | "danger" | "info";
  /** The path forward, if one exists. */
  action?: React.ReactNode;
  className?: string;
}

const noticeTones = {
  warning: "border-warning/50 bg-warning/8 text-warning",
  danger: "border-danger/50 bg-danger/8 text-danger",
  info: "border-info/50 bg-info/8 text-info"
} as const;

export function GuardrailNotice({
  title,
  reason,
  tone = "warning",
  action,
  className
}: GuardrailNoticeProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-2 rounded-md border p-4 text-start",
        noticeTones[tone],
        className
      )}
    >
      <span className="font-ui text-14 font-medium">{title}</span>
      <span className="font-ui text-13 text-muted">{reason}</span>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export interface BudgetMeterProps {
  /** Tokens (or currency minor units) consumed in the current window. */
  used: number;
  limit: number;
  label?: string;
  /** e.g. "tokens", "AED". */
  unit?: string;
  /** When the window rolls over. */
  resetsAt?: React.ReactNode;
  locale?: string;
  className?: string;
}

/** AI spend against the tenant's cap — docs/07 §2 "BudgetMeter (AI tokens)". */
export function BudgetMeter({
  used,
  limit,
  label = "AI budget",
  unit = "tokens",
  resetsAt,
  locale = "en",
  className
}: BudgetMeterProps) {
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const tone: BadgeTone = pct >= 100 ? "danger" : pct >= 80 ? "warning" : "accent";
  const nf = new Intl.NumberFormat(locale);
  return (
    <div className={cn("flex flex-col gap-1.5 text-start", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-ui text-12 uppercase tracking-wider text-subtle">{label}</span>
        <span className="font-ui text-12 tabular-nums text-muted">
          {nf.format(used)} / {nf.format(limit)} {unit}
        </span>
      </div>
      <ProgressBar
        value={Math.min(pct, 100)}
        tone={tone}
        label={`${label}: ${pct} percent of ${nf.format(limit)} ${unit} used`}
      />
      {resetsAt ? <span className="font-ui text-11 text-subtle">Resets {resetsAt}</span> : null}
      {pct >= 100 ? (
        <span role="alert" className="font-ui text-12 text-danger">
          Budget exhausted — agent runs are paused until the window resets or the cap is raised.
        </span>
      ) : null}
    </div>
  );
}

export interface ApprovalStripProps {
  /** What is waiting, stated plainly. */
  summary: React.ReactNode;
  /** The consequence of approving. Required for consequential actions. */
  consequence?: React.ReactNode;
  requestedBy?: string;
  onApprove?: () => void;
  onReject?: () => void;
  /** Explains why approval is unavailable — shown instead of a dead control. */
  blockedReason?: React.ReactNode;
  className?: string;
  /** Region landmark name — pass the caller's i18n string; defaults to English (CLAUDE.md §7). */
  label?: string;
}

/**
 * Docks at the block-end of a Case Room while something is pending (docs/07 §4).
 * A blocked strip explains itself rather than rendering a disabled button
 * (docs/22 §5.4).
 */
export function ApprovalStrip({
  summary,
  consequence,
  requestedBy,
  onApprove,
  onReject,
  blockedReason,
  className,
  label = "Pending approval"
}: ApprovalStripProps) {
  return (
    <div
      role="region"
      aria-label={label}
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-lg border border-accent/40 bg-accent/8 p-4 text-start",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="font-ui text-14 text-text">{summary}</p>
        {consequence ? (
          <p className="mt-1 font-ui text-12 text-muted">{consequence}</p>
        ) : null}
        {requestedBy ? (
          <p className="mt-1 font-ui text-11 text-subtle">Requested by {requestedBy}</p>
        ) : null}
      </div>
      {blockedReason ? (
        <p className="font-ui text-12 text-warning">{blockedReason}</p>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          {onReject ? (
            <Button variant="ghost" {...(onReject ? { onClick: onReject } : {})}>
              Reject
            </Button>
          ) : null}
          {onApprove ? (
            <Button variant="primary" {...(onApprove ? { onClick: onApprove } : {})}>
              Approve
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
