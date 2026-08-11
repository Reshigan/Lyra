import { useEffect, useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import {
  AgentBadge,
  Badge,
  Button,
  Card,
  ConfidenceMeter,
  DateTime,
  EmptyState,
  EvidenceLink,
  Field,
  GhostText,
  GuardrailNotice,
  Input,
  KPIWall,
  Ref,
  Select,
  Stat,
  Textarea,
  cn,
  focusRing,
  type BadgeTone
} from "@lyra/ui";
import { ApiError, api } from "../api.server";
import { cloudflare } from "../context";
import { pseudoText } from "../i18n";
import { Gate } from "./staff";
import { useShellData } from "./workspace";

// The documents tab can list rows and stamp a verification. What it cannot do is
// the actual work: read what the model pulled out of a file, see how sure it was
// and why, correct the two fields it got wrong, and only then vouch for it.
//
// So the extracted values are ghost text — the model's proposal, sitting beside
// an empty box for the human's own answer, committed by nobody until someone
// submits. A field left blank keeps the model's value; a field filled in
// overrides it. Confidence is shown as what it is (docs/07 §3: a
// schema-conformance signal, not measured accuracy) and the ✦ chip carries that
// sentence as its "why".

/* --------------------------------------------------------------- contract */

export const PERM = {
  read: "axis:documents:read",
  /** `resources.ts` maps the documents update path to `:verify`. */
  correct: "axis:documents:verify",
  extract: "axis:documents:extract",
  /** docs/12 §2: opening a sealed identifier is its own permission, and audited. */
  pii: "core:pii:view"
} as const;

/** Status order is the desk's order: unread paper first, vouched-for paper last. */
export const DOC_STATUSES = ["received", "extracting", "extracted", "rejected", "verified"] as const;

/** The desk shows what is not yet trusted; verified rows live on the tab. */
export const OPEN_DOC_STATUSES = ["received", "extracting", "extracted", "rejected"] as const;

/** Below this a value is shown but not offered as if it were settled. */
export const REVIEW_FLOOR = 0.7;

const PAGE = 50;

/* ----------------------------------------------------------------- labels */

const LABELS: Record<string, Record<string, string>> = {
  en: {
    title: "Document intelligence",
    intro:
      "What the model read out of each file, how completely it filled the form, and the box to correct it. Nothing here is trusted until a person confirms it.",
    "stat.open": "Documents on the desk",
    "stat.extracted": "Read, awaiting a person",
    "stat.received": "Not read yet",
    "stat.rejected": "Rejected",
    "filter.label": "Show",
    "filter.open": "Not yet confirmed",
    "filter.all": "Everything",
    "filter.submit": "Apply",
    "why.title": "How this was read",
    why:
      "Structured by {model} from the text of this file. The percentage is how many of the requested fields came back filled — a completeness signal, not a measure of accuracy. That is why a person confirms the row.",
    "why.noModel": "No model has read this file yet.",
    "confidence.label": "Fields returned",
    "review.title": "Read this one properly",
    "review.reason":
      "The model left most of the form empty, so what it did return is the least reliable kind of guess. Check every field against the file.",
    "evidence.label": "Where this came from",
    "evidence.file": "File",
    "evidence.type": "Document type",
    "evidence.read": "Read at",
    "evidence.verified": "Confirmed by",
    "correct.title": "Correct and confirm",
    "correct.intro": "Leave a box empty to keep what the model read. Anything you type replaces it.",
    "correct.placeholder": "Your value",
    "correct.submit": "Save corrections",
    "correct.none": "There is nothing to correct until the file has been read.",
    "sealed.value": "Hidden",
    "sealed.why":
      "Identity numbers are stored encrypted, so this screen holds the sealed value rather than the number. Opening it needs the PII permission and is written to the audit log.",
    "sealed.submit": "Show identity numbers",
    "verify.submit": "Confirm",
    "verify.hint": "Stamps your name and the time on this row. It cannot be undone from here.",
    "extract.title": "Read this file",
    "extract.intro":
      "Paste the text of the document. Extraction runs against the platform's own gateway, inside the tenant's model budget.",
    "extract.rawText": "Document text",
    "extract.locale": "Language of the document",
    "extract.submit": "Read",
    "locale.en": "English",
    "locale.ar": "Arabic",
    "status.received": "Received",
    "status.extracting": "Being read",
    "status.extracted": "Read",
    "status.rejected": "Rejected",
    "status.verified": "Confirmed",
    "done.correct": "Corrections saved.",
    "done.reveal": "Identity numbers shown. This was recorded against your name.",
    "done.verify": "Confirmed.",
    "done.extract": "Read. Check the fields before confirming.",
    "empty.title": "Nothing waiting",
    "empty.body": "Every document has been read and confirmed.",
    "nav.label": "Documents",
    approvalTitle: "Waiting on an approval",
    approvalBody:
      "This is gated by {policy}. The request is recorded and takes effect once someone with the authority approves it.",
    approvalLink: "Open approvals",
    "problem.bad_intent": "The form did not carry an action this screen knows.",
    "problem.missing_doc": "No document was named.",
    "problem.missing_text": "Reading a file needs its text.",
    "problem.no_change": "Nothing was typed, so nothing was saved.",
    "problem.conflict": "Someone already moved this document. Reload to see where it got to."
  },
  ar: {
    title: "استقراء المستندات",
    intro:
      "ما قرأه النموذج من كل ملف، ومدى اكتمال تعبئته للحقول، ومكان تصحيحه. لا شيء هنا موثوق قبل أن يؤكده شخص.",
    "stat.open": "مستندات على المكتب",
    "stat.extracted": "مقروءة وبانتظار شخص",
    "stat.received": "لم تُقرأ بعد",
    "stat.rejected": "مرفوضة",
    "filter.label": "العرض",
    "filter.open": "غير مؤكدة بعد",
    "filter.all": "الكل",
    "filter.submit": "تطبيق",
    "why.title": "كيف قُرئ هذا",
    why:
      "تم تنظيمه بواسطة {model} من نص هذا الملف. النسبة تعبّر عن عدد الحقول التي رجعت معبّأة — أي مؤشر اكتمال لا مقياس دقة. ولهذا يؤكد الصف شخصٌ.",
    "why.noModel": "لم يقرأ أي نموذج هذا الملف بعد.",
    "confidence.label": "الحقول المُعادة",
    "review.title": "اقرأ هذا بتمعّن",
    "review.reason":
      "ترك النموذج معظم الحقول فارغة، لذا فما أعاده هو أضعف أنواع التقدير. راجع كل حقل مقابل الملف.",
    "evidence.label": "مصدر هذه القيم",
    "evidence.file": "الملف",
    "evidence.type": "نوع المستند",
    "evidence.read": "وقت القراءة",
    "evidence.verified": "أكّده",
    "correct.title": "التصحيح والتأكيد",
    "correct.intro": "اترك الخانة فارغة للإبقاء على ما قرأه النموذج. وما تكتبه يستبدله.",
    "correct.placeholder": "قيمتك",
    "correct.submit": "حفظ التصحيحات",
    "correct.none": "لا يوجد ما يُصحَّح قبل قراءة الملف.",
    "sealed.value": "مخفي",
    "sealed.why":
      "أرقام الهوية محفوظة مشفّرة، لذا تحمل هذه الشاشة القيمة المختومة لا الرقم نفسه. إظهارها يتطلب صلاحية البيانات الشخصية ويُسجَّل في سجل التدقيق.",
    "sealed.submit": "إظهار أرقام الهوية",
    "verify.submit": "تأكيد",
    "verify.hint": "يثبّت اسمك ووقتك على هذا الصف، ولا يمكن التراجع عنه من هنا.",
    "extract.title": "قراءة الملف",
    "extract.intro": "الصق نص المستند. تجري القراءة عبر بوابة المنصة نفسها وداخل ميزانية النماذج للمستأجر.",
    "extract.rawText": "نص المستند",
    "extract.locale": "لغة المستند",
    "extract.submit": "قراءة",
    "locale.en": "الإنجليزية",
    "locale.ar": "العربية",
    "status.received": "مستلَم",
    "status.extracting": "قيد القراءة",
    "status.extracted": "مقروء",
    "status.rejected": "مرفوض",
    "status.verified": "مؤكَّد",
    "done.correct": "حُفظت التصحيحات.",
    "done.reveal": "أُظهرت أرقام الهوية، وسُجّل ذلك باسمك.",
    "done.verify": "تم التأكيد.",
    "done.extract": "قُرئ. راجع الحقول قبل التأكيد.",
    "empty.title": "لا شيء بالانتظار",
    "empty.body": "كل المستندات قُرئت وأُكّدت.",
    "nav.label": "المستندات",
    approvalTitle: "بانتظار موافقة",
    approvalBody: "هذا الإجراء يمر بسياسة {policy}. سُجّل الطلب ويسري بعد موافقة صاحب الصلاحية.",
    approvalLink: "فتح الموافقات",
    "problem.bad_intent": "لم يحمل النموذج إجراءً تعرفه هذه الشاشة.",
    "problem.missing_doc": "لم يُحدَّد أي مستند.",
    "problem.missing_text": "قراءة الملف تحتاج نصه.",
    "problem.no_change": "لم يُكتب شيء، فلم يُحفظ شيء.",
    "problem.conflict": "حرّك شخصٌ هذا المستند قبلك. أعد التحميل لتعرف إلى أين وصل."
  }
};

export type Label = (key: string, vars?: Record<string, string>) => string;

export function labelsIn(locale: string): Label {
  return (key, vars) => {
    const raw = pseudoText(locale, LABELS[locale]?.[key] ?? LABELS["en"]?.[key] ?? key);
    return vars ? raw.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole) : raw;
  };
}

/* ----------------------------------------------------------------- shapes */

export interface DocRow {
  id: string;
  caseId: string | null;
  fileId: string;
  docType: string;
  status: string;
  extractionJson: string | null;
  /** 0–100 in the database; `ConfidenceMeter` wants 0–1. */
  extractionConfidence: number | null;
  extractionModel: string | null;
  verifiedBy: string | null;
  verifiedAt: number | null;
  createdAt: number;
}

/* ---------------------------------------------------------------- helpers */

/**
 * The model's answers, or an empty map when nothing was read. A field the model
 * omitted comes back as null and is shown as such — an empty box in the file is
 * information, and hiding the row would make it look unasked.
 */
export function fieldsOf(doc: Pick<DocRow, "extractionJson">): Record<string, string | null> {
  if (!doc.extractionJson) return {};
  try {
    const parsed: unknown = JSON.parse(doc.extractionJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key.startsWith("_")) continue;
      out[key] = typeof value === "string" && value.trim() ? value : null;
    }
    return out;
  } catch {
    // ponytail: a row whose JSON does not parse reads as "nothing extracted"
    // rather than throwing — one bad document must not blank the whole desk.
    return {};
  }
}

/**
 * The envelope packages/core/src/field-crypto.ts writes around a national
 * identifier. Restated here because the web app cannot import @lyra/core (same
 * reason approvals.ts is restated in approvals.tsx) — and because this screen
 * never decrypts anything: it only has to know not to render an envelope as if
 * it were what the model read off the document.
 */
const SEALED_PREFIX = "enc.v1.";

export const isSealedValue = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.startsWith(SEALED_PREFIX);

/**
 * `_bbox`: an optional reserved key living beside the real fields in the same
 * JSON — the model's own coordinates for a field, `[x, y, w, h]` as a percent
 * of the page, when it has them. No schema change, no migration: a document
 * with none just draws no boxes.
 */
export function bboxOf(doc: Pick<DocRow, "extractionJson">): Record<string, [number, number, number, number]> {
  if (!doc.extractionJson) return {};
  try {
    const parsed: unknown = JSON.parse(doc.extractionJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const raw = (parsed as Record<string, unknown>)["_bbox"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, [number, number, number, number]> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number")) {
        out[key] = value as [number, number, number, number];
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 0–100 stored, 0–1 rendered. Missing confidence is not zero confidence. */
export const confidenceOf = (doc: Pick<DocRow, "extractionConfidence">): number | null =>
  typeof doc.extractionConfidence === "number" ? doc.extractionConfidence / 100 : null;

export const needsReview = (doc: Pick<DocRow, "extractionConfidence">, floor = REVIEW_FLOOR): boolean => {
  const value = confidenceOf(doc);
  return value !== null && value < floor;
};

const STATUS_TONE: Record<string, BadgeTone> = {
  received: "neutral",
  extracting: "info",
  extracted: "accent",
  rejected: "danger",
  verified: "success"
};

export const statusTone = (status: string): BadgeTone => STATUS_TONE[status] ?? "neutral";

/**
 * Ghost text accepted: every submitted box that has something in it overrides
 * the model's value, and every empty box keeps it. Returns null when the human
 * typed nothing at all, so a no-op submission is refused instead of rewriting
 * the row with what it already said.
 */
export function mergeCorrections(
  model: Record<string, string | null>,
  typed: Record<string, string>
): Record<string, string | null> | null {
  const out: Record<string, string | null> = { ...model };
  let changed = false;
  for (const [key, raw] of Object.entries(typed)) {
    const value = raw.trim();
    // Only fields the model was asked about can be corrected — a stray form key
    // must not invent a column in the extraction.
    if (!(key in model) || !value || value === (model[key] ?? "")) continue;
    out[key] = value;
    changed = true;
  }
  return changed ? out : null;
}

/** `field:<name>` inputs, so a correction cannot collide with `intent` or `docId`. */
export const FIELD_PREFIX = "field:";

export function typedFrom(form: FormData): Record<string, string> {
  const typed: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (key.startsWith(FIELD_PREFIX) && typeof value === "string") {
      typed[key.slice(FIELD_PREFIX.length)] = value;
    }
  }
  return typed;
}

async function safe<T>(call: Promise<T>, fallback: T): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return fallback;
    throw error;
  }
}

/* ----------------------------------------------------------------- loader */

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const url = new URL(request.url);
  const all = url.searchParams.get("show") === "all";
  const docType = url.searchParams.get("docType");

  const docs = await safe(
    api<{ data: DocRow[] }>(
      `/v1/axis/documents?${all ? "" : `status=${OPEN_DOC_STATUSES.join(",")}&`}${
        docType ? `docType=${encodeURIComponent(docType)}&` : ""
      }sort=createdAt&order=desc&limit=${PAGE}`,
      { env, request }
    ),
    { data: [] as DocRow[] }
  );

  return { all, docType, docs: docs.data };
}

/* ----------------------------------------------------------------- action */

export interface Refusal {
  title: string;
  status: number;
  code?: string;
  detail?: string;
}

export interface ActionResult {
  problem: Refusal | null;
  done: string | null;
  /**
   * Plaintext, for this response only. It is never put back into a form value
   * or a loader, so a reload re-seals the screen and costs another audited
   * reveal — which is the point of docs/12 §2.
   */
  revealed?: Record<string, string> | null;
}

const refuse = (code: string, status = 400): ActionResult => ({
  problem: { title: code, status, code },
  done: null
});

export async function action({ request, context }: ActionFunctionArgs): Promise<ActionResult> {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("docId") ?? "").trim();
  const headers = { "idempotency-key": crypto.randomUUID() };
  const at = `/v1/axis/documents/${encodeURIComponent(id)}`;

  if (!id) return refuse("missing_doc");

  try {
    if (intent === "correct") {
      // The model's own values travel back with the form so the merge compares
      // against what the human was actually shown, not a row that has since moved.
      const merged = mergeCorrections(
        fieldsOf({ extractionJson: String(form.get("extractionJson") ?? "") || null }),
        typedFrom(form)
      );
      if (!merged) return refuse("no_change");

      // A corrected row is a human's answer, so the model's completeness score no
      // longer describes it. `verify` is what marks it trusted, not this.
      await api(at, {
        env,
        request,
        method: "PATCH",
        headers,
        body: { extractionJson: JSON.stringify(merged) }
      });
      return { problem: null, done: "correct" };
    }

    if (intent === "reveal") {
      const opened = await api<{ values: Record<string, string> }>(`${at}/reveal`, {
        env,
        request,
        method: "POST",
        headers,
        body: {}
      });
      return { problem: null, done: "reveal", revealed: opened?.values ?? {} };
    }

    if (intent === "verify") {
      // No body: `verifiedBy` and `verifiedAt` come from the session and the
      // server clock, and the endpoint refuses to let a caller name its verifier.
      await api(`${at}/verify`, { env, request, method: "POST", headers, body: {} });
      return { problem: null, done: "verify" };
    }

    if (intent === "extract") {
      const rawText = String(form.get("rawText") ?? "").trim();
      if (!rawText) return refuse("missing_text");
      const locale = String(form.get("locale") ?? "en") === "ar" ? "ar" : "en";

      await api(`${at}/extract`, { env, request, method: "POST", headers, body: { rawText, locale } });
      return { problem: null, done: "extract" };
    }
  } catch (error) {
    if (error instanceof ApiError) return { problem: error.problem, done: null };
    throw error;
  }

  return refuse("bad_intent");
}

export function phrase(problem: Refusal, l: Label): Refusal {
  const key = `problem.${problem.code ?? ""}`;
  const text = l(key);
  return text === key ? problem : { ...problem, title: text };
}

/* -------------------------------------------------------------- the screen */

export default function AxisDocIntel() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const navigation = useNavigation();

  const locale = shell?.locale ?? "en";
  const l = labelsIn(locale);
  const held = new Set(shell?.permissions ?? []);
  const busy = navigation.state !== "idle";

  const counted = (status: string) => loaded.docs.filter((doc) => doc.status === status).length;

  const [index, setIndex] = useState(0);
  const selected = loaded.docs[Math.min(index, Math.max(loaded.docs.length - 1, 0))];
  const model = selected ? fieldsOf(selected) : {};
  const names = Object.keys(model);
  const confidence = selected ? confidenceOf(selected) : null;
  // Plaintext lives here for exactly as long as this render: a reveal is scoped
  // to the document it was asked for, so switching rows re-seals the screen.
  const opened = result?.done === "reveal" && result.revealed ? result.revealed : {};
  const shown = (name: string): string | null => opened[name] ?? model[name] ?? null;
  const sealedNames = names.filter((name) => isSealedValue(model[name]) && !(name in opened));
  const boxes = selected ? bboxOf(selected) : {};

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "j") setIndex((i) => Math.min(i + 1, loaded.docs.length - 1));
      else if (event.key === "k") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loaded.docs.length]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-22 leading-[1.2] text-text">{l("title")}</h1>
        <p className="max-w-prose font-ui text-13 text-subtle">{l("intro")}</p>
      </header>

      {result?.problem ? <Gate problem={phrase(result.problem, l)} l={l} /> : null}
      {result?.done ? (
        <p role="status" className="font-ui text-13 text-success">
          {l(`done.${result.done}`)}
        </p>
      ) : null}

      <KPIWall>
        <Stat label={l("stat.open")} value={loaded.docs.length} />
        <Stat label={l("stat.extracted")} value={counted("extracted")} />
        <Stat label={l("stat.received")} value={counted("received")} />
        <Stat label={l("stat.rejected")} value={counted("rejected")} />
      </KPIWall>

      <Form method="get" className="flex flex-wrap items-end gap-3">
        <Field label={l("filter.label")} className="w-56">
          <Select
            name="show"
            defaultValue={loaded.all ? "all" : "open"}
            options={[
              { value: "open", label: l("filter.open") },
              { value: "all", label: l("filter.all") }
            ]}
          />
        </Field>
        <Button type="submit" variant="secondary" loading={busy}>
          {l("filter.submit")}
        </Button>
      </Form>

      {loaded.docs.length === 0 ? <EmptyState title={l("empty.title")} body={l("empty.body")} /> : null}

      {selected ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr_1fr]">
          <ul className="flex flex-col gap-1 lg:max-h-[70vh] lg:overflow-y-auto" aria-label={l("nav.label")}>
            {loaded.docs.map((doc, i) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-current={i === index ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-start font-ui text-12",
                    focusRing,
                    i === index ? "bg-surface-2 text-accent" : "text-muted"
                  )}
                >
                  <span className="truncate">{doc.docType}</span>
                  <Badge tone={statusTone(doc.status)} size="sm">
                    {l(`status.${doc.status}`)}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>

          <div className="relative overflow-hidden rounded border border-border bg-surface-2 lg:max-h-[70vh]">
            <img
              src={`/axis/documents/${selected.id}/file`}
              alt={selected.docType}
              className="block w-full object-contain"
            />
            {Object.entries(boxes).map(([name, [x, y, w, h]]) => (
              <span
                key={name}
                title={name}
                className="pointer-events-none absolute border-2 border-accent"
                style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
              />
            ))}
          </div>

          <Card
            key={selected.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/axis/documents/${selected.id}`}
                  className="font-mono text-13 text-accent underline underline-offset-2"
                >
                  {selected.docType}
                </Link>
                <Badge tone={statusTone(selected.status)} size="sm">
                  {l(`status.${selected.status}`)}
                </Badge>
                {selected.extractionModel ? (
                  <AgentBadge
                    agent={selected.extractionModel}
                    why={
                      <span className="font-ui text-12 text-muted">
                        {l("why", { model: selected.extractionModel })}
                      </span>
                    }
                  />
                ) : null}
              </span>
            }
            description={
              <EvidenceLink
                sourceLabel={l("evidence.label")}
                source={
                  <span className="flex flex-col gap-1 font-ui text-12 text-muted">
                    <span>
                      {l("evidence.file")}: <Ref value={selected.fileId} />
                    </span>
                    <span>
                      {l("evidence.type")}: {selected.docType}
                    </span>
                    <span>
                      {l("evidence.read")}: <DateTime value={selected.createdAt} locale={locale} />
                    </span>
                    {selected.verifiedBy ? (
                      <span>
                        {l("evidence.verified")}: {selected.verifiedBy}
                        {selected.verifiedAt ? (
                          <>
                            {" · "}
                            <DateTime value={selected.verifiedAt} locale={locale} />
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                }
              >
                {selected.fileId}
              </EvidenceLink>
            }
          >
            <div className="flex flex-col gap-4">
              {confidence !== null ? (
                <ConfidenceMeter value={confidence} label={l("confidence.label")} floor={REVIEW_FLOOR} />
              ) : null}

              {needsReview(selected) ? (
                <GuardrailNotice tone="warning" title={l("review.title")} reason={l("review.reason")} />
              ) : null}

              {sealedNames.length > 0 && held.has(PERM.pii) ? (
                <Form method="post" className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="intent" value="reveal" />
                  <input type="hidden" name="docId" value={selected.id} />
                  <Button type="submit" variant="ghost" loading={busy}>
                    {l("sealed.submit")}
                  </Button>
                  <span className="font-ui text-12 text-subtle">{l("sealed.why")}</span>
                </Form>
              ) : null}

              {names.length === 0 ? (
                <p className="font-ui text-13 text-subtle">{l("correct.none")}</p>
              ) : held.has(PERM.correct) ? (
                <Form method="post" className="flex flex-col gap-3">
                  <input type="hidden" name="intent" value="correct" />
                  <input type="hidden" name="docId" value={selected.id} />
                  <input type="hidden" name="extractionJson" value={selected.extractionJson ?? ""} />
                  <p className="font-ui text-12 text-subtle">{l("correct.intro")}</p>
                  <ul className="flex flex-col gap-3">
                    {names.map((name) => (
                      <li key={name} className="flex flex-wrap items-end gap-3">
                        <Field label={name} className="w-64">
                          <Input name={`${FIELD_PREFIX}${name}`} placeholder={l("correct.placeholder")} />
                        </Field>
                        <span className="pb-2 font-ui text-13">
                          {isSealedValue(shown(name)) ? (
                            <Badge tone="neutral" title={l("sealed.why")}>
                              {l("sealed.value")}
                            </Badge>
                          ) : shown(name) ? (
                            <GhostText text={shown(name)!} />
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <span className="flex flex-wrap items-center gap-3">
                    <Button type="submit" variant="secondary" loading={busy}>
                      {l("correct.submit")}
                    </Button>
                  </span>
                </Form>
              ) : (
                <ul className="flex flex-col gap-2">
                  {names.map((name) => (
                    <li key={name} className="flex flex-wrap items-center gap-2 font-ui text-13">
                      <span className="text-muted">{name}</span>
                      {isSealedValue(shown(name)) ? (
                        <Badge tone="neutral" title={l("sealed.why")}>
                          {l("sealed.value")}
                        </Badge>
                      ) : (
                        <span className="text-text">{shown(name) ?? "—"}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {held.has(PERM.correct) && selected.status !== "verified" ? (
                <Form method="post" className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="intent" value="verify" />
                  <input type="hidden" name="docId" value={selected.id} />
                  <Button type="submit" variant="primary" loading={busy}>
                    {l("verify.submit")}
                  </Button>
                  <span className="font-ui text-12 text-subtle">{l("verify.hint")}</span>
                </Form>
              ) : null}

              {held.has(PERM.extract) && selected.status === "received" ? (
                <Form method="post" className="flex flex-col gap-3 border-t border-border pt-4">
                  <input type="hidden" name="intent" value="extract" />
                  <input type="hidden" name="docId" value={selected.id} />
                  <p className="font-ui text-13 font-medium text-text">{l("extract.title")}</p>
                  <p className="font-ui text-12 text-subtle">{l("extract.intro")}</p>
                  <Field label={l("extract.rawText")}>
                    <Textarea name="rawText" required maxLength={20_000} rows={4} />
                  </Field>
                  <span className="flex flex-wrap items-end gap-3">
                    <Field label={l("extract.locale")} className="w-40">
                      <Select
                        name="locale"
                        defaultValue={locale === "ar" ? "ar" : "en"}
                        options={[
                          { value: "en", label: l("locale.en") },
                          { value: "ar", label: l("locale.ar") }
                        ]}
                      />
                    </Field>
                    <Button type="submit" variant="secondary" loading={busy}>
                      {l("extract.submit")}
                    </Button>
                  </span>
                </Form>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
