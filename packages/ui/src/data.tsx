/**
 * Data display — Table, Pagination (keyset), EmptyState, Stat, Sparkline,
 * Timeline, AuditTrail. docs/07 §2 and docs/22 §1.
 */
import * as React from "react";
import { cn, focusRing } from "./cn.js";
import { Badge, Button, type BadgeTone } from "./primitives.js";
import { DateTime } from "./format.js";

/* -------------------------------------------------------------------------- */
/* Table                                                                       */
/* -------------------------------------------------------------------------- */

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string;
  direction: SortDirection;
}

export interface Column<T> {
  key: string;
  header: string;
  /** Renders the cell. Keep money in <Money> and dates in <DateTime>. */
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  /** Numeric columns align to the inline-end edge and use tabular figures. */
  numeric?: boolean;
  width?: string;
  /** Column heading shown to assistive tech when `header` is a glyph. */
  headerLabel?: string;
}

export interface TableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  /** Required: tables carry a caption for screen readers (WCAG 2.2 AA). */
  caption: string;
  captionHidden?: boolean;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  density?: "comfortable" | "compact";
  stickyHeader?: boolean;
  /** Row treatment — docs/22 §1: posted lines look sealed, drafts look editable. */
  rowState?: (row: T) => "sealed" | "draft" | undefined;
  onRowActivate?: (row: T) => void;
  empty?: React.ReactNode;
  /** Keyset pager / bulk bar slot, rendered under the table. */
  footer?: React.ReactNode;
  className?: string;
}

function nextDirection(current: SortState | undefined, key: string): SortDirection {
  return current?.key === key && current.direction === "asc" ? "desc" : "asc";
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  caption,
  captionHidden = true,
  sort,
  onSortChange,
  density = "comfortable",
  stickyHeader = true,
  rowState,
  onRowActivate,
  empty,
  footer,
  className
}: TableProps<T>) {
  const cellPad = density === "compact" ? "px-2.5 py-1.5" : "px-3 py-2.5";

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse font-ui text-13">
          <caption
            className={cn(
              "text-start font-ui text-12 text-subtle",
              captionHidden ? "sr-only" : "p-3"
            )}
          >
            {caption}
          </caption>
          <thead className={cn(stickyHeader && "sticky top-0 z-10")}>
            <tr>
              {columns.map((col) => {
                const active = sort?.key === col.key;
                const ariaSort = active
                  ? sort.direction === "asc"
                    ? "ascending"
                    : "descending"
                  : col.sortable
                    ? "none"
                    : undefined;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    {...(ariaSort ? { "aria-sort": ariaSort } : {})}
                    style={col.width ? { inlineSize: col.width } : undefined}
                    className={cn(
                      "border-b border-border bg-surface-1 font-medium uppercase tracking-wider text-11 text-subtle",
                      cellPad,
                      col.numeric ? "text-end" : "text-start"
                    )}
                  >
                    {col.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange({ key: col.key, direction: nextDirection(sort, col.key) })}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm uppercase hover:text-text",
                          active && "text-accent",
                          focusRing
                        )}
                      >
                        <span>{col.headerLabel ?? col.header}</span>
                        <span aria-hidden="true">{active ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}</span>
                      </button>
                    ) : (
                      (col.headerLabel ?? col.header)
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const state = rowState?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  {...(onRowActivate
                    ? {
                        tabIndex: 0,
                        role: "button",
                        onClick: () => onRowActivate(row),
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowActivate(row);
                          }
                        }
                      }
                    : {})}
                  className={cn(
                    "border-b border-border/60",
                    // Sealed rows never gain hover elevation (docs/22 §1).
                    state === "sealed"
                      ? "bg-surface-1 border-s-[3px] border-s-success"
                      : state === "draft"
                        ? "bg-surface-2 border-s-[3px] border-s-dashed border-s-subtle"
                        : onRowActivate
                          ? "hover:bg-surface-2"
                          : undefined,
                    onRowActivate && focusRing
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        cellPad,
                        "align-top text-muted",
                        col.numeric ? "text-end tabular-nums text-text" : "text-start"
                      )}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-8 text-center">
                  {empty ?? <span className="font-ui text-13 text-subtle">Nothing here yet.</span>}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination — keyset, not offset                                             */
/* -------------------------------------------------------------------------- */

export interface PaginationProps {
  /** Keyset cursors: presence, not page numbers, drives the controls. */
  hasPrevious?: boolean;
  hasNext?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  /** e.g. "51–100" — keyset paging has no total, so never render "of N". */
  rangeLabel?: string;
  pageSize?: number;
  pageSizes?: number[];
  onPageSizeChange?: (size: number) => void;
  label?: string;
  /** Row-count select label. Caller passes its own i18n string; English default for untranslated call sites. */
  rowsLabel?: string;
  previousLabel?: string;
  nextLabel?: string;
  className?: string;
}

export function Pagination({
  hasPrevious = false,
  hasNext = false,
  onPrevious,
  onNext,
  rangeLabel,
  pageSize,
  pageSizes = [25, 50, 100],
  onPageSizeChange,
  label = "Pagination",
  rowsLabel = "Rows",
  previousLabel = "Previous",
  nextLabel = "Next",
  className
}: PaginationProps) {
  return (
    <nav
      aria-label={label}
      className={cn("flex flex-wrap items-center justify-between gap-3", className)}
    >
      <div className="flex items-center gap-3">
        {rangeLabel ? (
          <span className="font-ui text-12 tabular-nums text-subtle" aria-live="polite">
            {rangeLabel}
          </span>
        ) : null}
        {onPageSizeChange && pageSize !== undefined ? (
          <label className="flex items-center gap-2 font-ui text-12 text-subtle">
            <span>{rowsLabel}</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.currentTarget.value))}
              className={cn(
                "h-8 rounded-md border border-border bg-surface-1 px-2 text-12 text-text",
                focusRing
              )}
            >
              {pageSizes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!hasPrevious}
          {...(onPrevious ? { onClick: onPrevious } : {})}
          aria-label={previousLabel}
        >
          <span aria-hidden="true">‹</span>
          <span>{previousLabel}</span>
        </Button>
        <Button
          size="sm"
          disabled={!hasNext}
          {...(onNext ? { onClick: onNext } : {})}
          aria-label={nextLabel}
        >
          <span>{nextLabel}</span>
          <span aria-hidden="true">›</span>
        </Button>
      </div>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* EmptyState                                                                  */
/* -------------------------------------------------------------------------- */

export interface EmptyStateProps {
  title: string;
  /** Empty states teach: say what it means, then offer one action (docs/07 §5). */
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** Thin-line constellation — the house illustration idiom (docs/01 §5). */
function ConstellationArt() {
  return (
    <svg viewBox="0 0 120 80" className="h-16 w-auto" role="presentation" aria-hidden="true">
      <g fill="none" stroke="var(--text-subtle)" strokeWidth="1.2" opacity="0.7">
        <path d="M42 44 L72 36 L83 68 L53 76 Z" />
        <path d="M25 24 L42 44" />
      </g>
      <g fill="var(--text-muted)">
        <circle cx="42" cy="44" r="2.4" />
        <circle cx="72" cy="36" r="2" />
        <circle cx="83" cy="68" r="2" />
        <circle cx="53" cy="76" r="2" />
      </g>
      <circle cx="25" cy="24" r="5" fill="var(--accent)" />
    </svg>
  );
}

export function EmptyState({ title, body, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center",
        className
      )}
    >
      <ConstellationArt />
      <h3 className="font-display text-16 font-medium text-text">{title}</h3>
      {body ? <p className="max-w-prose font-ui text-13 text-subtle">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat / Sparkline / KPIWall                                                  */
/* -------------------------------------------------------------------------- */

export interface StatProps {
  label: string;
  value: React.ReactNode;
  /** Signed delta, e.g. +4.2. ion for positive, flare for negative (docs/01 §3). */
  delta?: number;
  deltaSuffix?: string;
  /** For metrics where down is good (cost, latency). */
  invertDelta?: boolean;
  hint?: React.ReactNode;
  /** Applies the "twinkle" treatment to live-updating numbers (docs/01 §5). */
  live?: boolean;
  className?: string;
}

export function Stat({
  label,
  value,
  delta,
  deltaSuffix = "",
  invertDelta = false,
  hint,
  live = false,
  className
}: StatProps) {
  const good = delta === undefined ? undefined : invertDelta ? delta < 0 : delta > 0;
  const tone: BadgeTone = good === undefined ? "neutral" : good ? "success" : "danger";
  return (
    <div className={cn("flex flex-col gap-1 text-start", className)}>
      <span className="font-ui text-12 uppercase tracking-wider text-subtle">{label}</span>
      <span
        className={cn(
          "font-display text-28 font-bold tabular-nums text-text",
          live && "motion-safe:animate-twinkle"
        )}
      >
        {value}
      </span>
      {delta !== undefined ? (
        <Badge tone={tone} size="sm">
          {delta > 0 ? "+" : ""}
          {delta}
          {deltaSuffix}
        </Badge>
      ) : null}
      {hint ? <span className="font-ui text-12 text-subtle">{hint}</span> : null}
    </div>
  );
}

export interface SparklineProps {
  values: number[];
  /** Required: the chart is an image and needs a text alternative. */
  label: string;
  tone?: "accent" | "success" | "danger" | "info";
  className?: string;
}

/** ponytail: a polyline is a sparkline. No chart library for 40 numbers. */
export function Sparkline({ values, label, tone = "accent", className }: SparklineProps) {
  const w = 100;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const stroke = {
    accent: "var(--accent)",
    success: "var(--success)",
    danger: "var(--danger)",
    info: "var(--info)"
  }[tone];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn("h-7 w-full", className)}
    >
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function KPIWall({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-6 sm:grid-cols-2 lg:grid-cols-4", className)}>{children}</div>
  );
}

/* -------------------------------------------------------------------------- */
/* Timeline / AuditTrail                                                       */
/* -------------------------------------------------------------------------- */

export interface TimelineEvent {
  id: string;
  title: string;
  at: Date | string | number;
  /** Who did it — a person, or an agent with its autonomy level. */
  actor?: string;
  detail?: React.ReactNode;
  tone?: BadgeTone;
  /** State-machine steps waiting on a third party are named, never spinners. */
  pending?: boolean;
}

export interface TimelineProps {
  events: TimelineEvent[];
  label: string;
  locale?: string;
  timeZone?: string;
  className?: string;
}

export function Timeline({ events, label, locale, timeZone, className }: TimelineProps) {
  return (
    <ol aria-label={label} className={cn("flex flex-col border-s border-border ps-5", className)}>
      {events.map((e) => (
        <li key={e.id} className="relative pb-5 last:pb-0">
          <span
            aria-hidden="true"
            className={cn("absolute top-1.5 size-2 rounded-orbit", e.pending ? "bg-warning" : "bg-accent")}
            style={{ insetInlineStart: "-26px" }}
          />
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-ui text-14 text-text">{e.title}</span>
            {e.tone ? (
              <Badge tone={e.tone} size="sm">
                {e.pending ? "Waiting" : "Done"}
              </Badge>
            ) : null}
          </div>
          <div className="mt-0.5 font-ui text-12 text-subtle">
            <DateTime value={e.at} precision="minute" {...(locale ? { locale } : {})} {...(timeZone ? { timeZone } : {})} />
            {e.actor ? <span> · {e.actor}</span> : null}
          </div>
          {e.detail ? <div className="mt-1 font-ui text-13 text-muted">{e.detail}</div> : null}
        </li>
      ))}
    </ol>
  );
}

export interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  at: Date | string | number;
  target?: string;
  /** Immutable audit rows are read-only by construction: no controls exist. */
  detail?: React.ReactNode;
}

export function AuditTrail({
  entries,
  label = "Audit trail",
  className
}: {
  entries: AuditEntry[];
  label?: string;
  className?: string;
}) {
  return (
    <Table<AuditEntry>
      {...(className ? { className } : {})}
      caption={label}
      rows={entries}
      rowKey={(e) => e.id}
      density="compact"
      rowState={() => "sealed"}
      columns={[
        { key: "at", header: "When", render: (e) => <DateTime value={e.at} precision="second" /> },
        { key: "actor", header: "Actor", render: (e) => e.actor },
        { key: "action", header: "Action", render: (e) => <span className="font-mono text-12">{e.action}</span> },
        { key: "target", header: "Target", render: (e) => e.target ?? "—" },
        { key: "detail", header: "Detail", render: (e) => e.detail ?? null }
      ]}
    />
  );
}
