import * as React from "react";
import { Button, Card, DatePicker, Field, Input, Select, Textarea } from "@lyra/ui";
import { ApiError, api, type Problem } from "../api.server";
import type { Env } from "../env";
import type { Label } from "./detail-kit";
import { Gate } from "./staff";

// Shared chrome for the guided creation flows (/axis/new-*, /admin/new-*).
// The mockup's `formShell` is one layout repeated six times — heading, a card of
// fields, a footer that says nothing is created until you confirm, and an aside
// of context — so it lives here once and the six routes are field lists.
//
// ponytail: no Stepper primitive in @lyra/ui. `Steps` is an ordered list with
// aria-current; promote it to packages/ui when a second surface needs it.
//
// Every write goes through `createRow`, which is the only place the
// `idempotency-key` header and the approval-gate 403 are handled: a wizard that
// forgets either is a wizard that double-books or lies about a refused write.

/* ------------------------------------------------------------------ results */

export interface WizardResult {
  problem: Problem | null;
  /** The id the API assigned, once the write actually landed. */
  created: string | null;
  /** A label key for a refusal decided here — nothing was sent. */
  error: string | null;
}

export const NOTHING: WizardResult = { problem: null, created: null, error: null };

export function refuse(error: string): WizardResult {
  return { ...NOTHING, error };
}

/** An intent the route does not implement is a 400 it can render, not a crash. */
export function unknownIntent(): WizardResult {
  return { ...NOTHING, problem: { title: "unknown intent", status: 400 } };
}

/**
 * POST a creation. The idempotency key comes from the loader, so a double
 * submit of the same form replays the first answer instead of creating twice
 * (apps/api/src/crud.ts withIdempotency). An `approval_required` 403 is
 * information, not a failure: it comes back as a problem for `Outcome` to
 * render through `Gate` (CLAUDE.md §4).
 */
export async function createRow(
  path: string,
  init: { env: Env; request: Request; body: unknown; key: string }
): Promise<WizardResult> {
  try {
    const row = await api<{ id?: string }>(path, {
      env: init.env,
      request: init.request,
      method: "POST",
      body: init.body,
      headers: { "idempotency-key": init.key }
    });
    return { ...NOTHING, created: row.id ?? path };
  } catch (error) {
    if (error instanceof ApiError) return { ...NOTHING, problem: error.problem };
    throw error;
  }
}

/* ------------------------------------------------------------------- fields */

export type FieldKind = "text" | "number" | "money" | "date" | "datetime" | "select" | "textarea";

export interface FieldSpec {
  /**
   * The form field name *and* the label key — so naming a field `premiumMinor`
   * is what lets a domain pack rename it (CLAUDE.md §14). Options are labelled
   * `<name>.<value>`.
   */
  name: string;
  kind?: FieldKind;
  options?: string[];
  required?: boolean;
  /** Label key for the hint under the control. */
  hint?: string;
  /** Full width in the two-column grid. */
  wide?: boolean;
}

/** The first required field left blank, or null. Mirrors the API's NOT NULLs. */
export function missing(form: FormData, specs: FieldSpec[]): string | null {
  for (const spec of specs) {
    if (spec.required && text(form, spec.name) === "") return spec.name;
  }
  return null;
}

/** A trimmed string field. */
export function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

/**
 * Major units to minor. Returns null for "not a number" and undefined for
 * blank, so a caller can tell "leave it out" from "the operator typed rubbish".
 * Negative is rubbish here: crud.ts refuses a negative `*Minor` anyway.
 */
export function minor(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** A whole number field (a count, a day count). Same three-way answer. */
export function whole(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/** Drops the keys a wizard left blank so the API applies its own defaults. */
export function given<T extends Record<string, unknown>>(body: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined && value !== "")
  ) as Partial<T>;
}

export function Fields({
  specs,
  l,
  values
}: {
  specs: FieldSpec[];
  l: Label;
  values?: Record<string, string>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {specs.map((spec) => (
        <Field
          key={spec.name}
          label={l(spec.name)}
          required={spec.required ?? false}
          {...(spec.hint ? { hint: l(spec.hint) } : {})}
          className={spec.wide ? "sm:col-span-2" : undefined}
        >
          <Control spec={spec} l={l} value={values?.[spec.name] ?? ""} />
        </Field>
      ))}
    </div>
  );
}

function Control({ spec, l, value }: { spec: FieldSpec; l: Label; value: string }) {
  const kind = spec.kind ?? "text";
  if (kind === "select") {
    return (
      <Select
        name={spec.name}
        defaultValue={value}
        options={[
          { value: "", label: l("choose") },
          ...(spec.options ?? []).map((option) => ({
            value: option,
            label: l(`${spec.name}.${option}`)
          }))
        ]}
      />
    );
  }
  if (kind === "textarea") return <Textarea name={spec.name} defaultValue={value} rows={5} />;
  if (kind === "date" || kind === "datetime") {
    return <DatePicker name={spec.name} defaultValue={value} withTime={kind === "datetime"} />;
  }
  if (kind === "money" || kind === "number") {
    return (
      <Input
        name={spec.name}
        defaultValue={value}
        type="number"
        min="0"
        step={kind === "money" ? "0.01" : "1"}
        inputMode="decimal"
      />
    );
  }
  return <Input name={spec.name} defaultValue={value} />;
}

/* ------------------------------------------------------------------- layout */

/**
 * The mockup's `formShell`: title, a 1.5fr/1fr split of the form and its
 * context, and a footer that is the honest part — nothing exists until confirm.
 */
export function WizardShell({
  l,
  title,
  intro,
  steps,
  step,
  aside,
  actions,
  children
}: {
  l: Label;
  /** Label key. */
  title: string;
  /** Label key. */
  intro: string;
  /** Label keys, in order. */
  steps?: string[];
  /** Zero-based index of the current step. */
  step?: number;
  aside?: React.ReactNode;
  actions: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-24 font-medium text-text">{l(title)}</h1>
        <p className="max-w-prose font-ui text-13 text-subtle">{l(intro)}</p>
      </header>
      {steps ? <Steps l={l} steps={steps} step={step ?? 0} /> : null}
      <div className="grid items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card className="flex flex-col gap-5 p-5">
          {children}
          <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-ui text-12 text-subtle">{l("nothingYet")}</span>
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
        </Card>
        {aside ? <div className="flex flex-col gap-4">{aside}</div> : null}
      </div>
    </div>
  );
}

export function Steps({ l, steps, step }: { l: Label; steps: string[]; step: number }) {
  return (
    <ol className="flex flex-wrap gap-2 font-ui text-12">
      {steps.map((key, index) => (
        <li
          key={key}
          {...(index === step ? { "aria-current": "step" as const } : {})}
          className={
            index === step
              ? "rounded-full border border-accent bg-accent/10 px-3 py-1 text-accent"
              : "rounded-full border border-line px-3 py-1 text-subtle"
          }
        >
          <span className="font-mono">{index + 1}</span>
          <span className="ms-2">{l(key)}</span>
        </li>
      ))}
    </ol>
  );
}

/** A titled context panel — the mockup's right-hand column. */
export function Aside({
  l,
  title,
  mark = false,
  children
}: {
  l: Label;
  /** Label key. */
  title: string;
  /** Marks the panel as AI-authored (docs/15: one ✦, never a modal). */
  mark?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <h2 className="font-ui text-13 font-medium text-muted">
        {mark ? <span className="me-1 text-accent">{"✦"}</span> : null}
        {l(title)}
      </h2>
      {children}
    </Card>
  );
}

/** A read-only fact row: label, value. */
export function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-0">
      <span className="font-ui text-12 text-subtle">{label}</span>
      <span className="font-ui text-13 text-text">{value}</span>
    </div>
  );
}

/** Bulleted context. `items` are label keys. */
export function Notes({ l, items }: { l: Label; items: string[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((key) => (
        <li key={key} className="font-ui text-12 text-subtle">
          {l(key)}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ outcome */

/**
 * What happened to the write. A refused-for-approval 403 renders as the
 * approval path via `Gate`; a success says what was created and never implies
 * more than the API did.
 */
export function Outcome({ result, l }: { result: WizardResult | undefined; l: Label }) {
  if (!result) return null;
  if (result.error) {
    return (
      <p role="alert" className="font-ui text-13 text-danger">
        {l(`error.${result.error}`)}
      </p>
    );
  }
  if (result.problem) return <Gate problem={result.problem} l={l} />;
  if (result.created) {
    return (
      <p role="status" className="font-ui text-13 text-success">
        {l("createdOk", { id: result.created })}
      </p>
    );
  }
  return null;
}

/** The submit row every wizard ends with. */
export function Submit({ l, busy, label }: { l: Label; busy: boolean; label: string }) {
  return (
    <Button type="submit" disabled={busy}>
      {busy ? l("working") : l(label)}
    </Button>
  );
}
