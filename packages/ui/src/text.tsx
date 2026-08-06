/**
 * Kit chrome — the words the design system says on its own behalf: "Approve",
 * the audit-trail headers, an empty table's fallback line. They are not the
 * app's copy (that lives in apps/web/app/i18n) and they are not the caller's
 * problem: 98 Table call sites will never all remember to pass a translated
 * empty state, so the kit carries its own catalogue and reads one locale off a
 * provider at the document root.
 *
 * Every one of these is still overridable per call — a prop wins over the
 * catalogue. The catalogue is what happens when nobody passes anything.
 *
 * ponytail: two locales, plain objects, `{slot}` interpolation. No ICU runtime
 * until a kit string needs a plural or an inline date; add a locale by adding a
 * column.
 */
import * as React from "react";

const en = {
  // Table / Pagination / AuditTrail
  empty: "Nothing here yet.",
  pagination: "Pagination",
  rows: "Rows",
  previous: "Previous",
  next: "Next",
  auditTrail: "Audit trail",
  when: "When",
  actor: "Actor",
  action: "Action",
  target: "Target",
  detail: "Detail",
  // Timeline
  waiting: "Waiting",
  done: "Done",
  // Ambient AI (docs/15)
  aiGenerated: "AI-generated",
  draftedBy: "Drafted by {agent}",
  whyDrafted: "Why this was drafted",
  accept: "Accept",
  discard: "Discard",
  confidence: "Model confidence",
  evidence: "Evidence",
  aiBudget: "AI budget",
  tokens: "tokens",
  percentLabel: "{label}: {value} percent",
  budgetUsage: "{label}: {value} percent of {limit} {unit} used",
  resets: "Resets",
  budgetExhausted:
    "Budget exhausted — agent runs are paused until the window resets or the cap is raised.",
  pendingApproval: "Pending approval",
  requestedBy: "Requested by {who}",
  approve: "Approve",
  reject: "Reject"
} as const;

export type KitKey = keyof typeof en;

const ar: Record<KitKey, string> = {
  empty: "لا شيء هنا بعد.",
  pagination: "التنقّل بين الصفحات",
  rows: "الصفوف",
  previous: "السابق",
  next: "التالي",
  auditTrail: "سجل التدقيق",
  when: "الوقت",
  actor: "المنفّذ",
  action: "الإجراء",
  target: "الهدف",
  detail: "التفاصيل",
  waiting: "قيد الانتظار",
  done: "تم",
  aiGenerated: "من إنشاء الذكاء الاصطناعي",
  draftedBy: "صاغها {agent}",
  whyDrafted: "سبب هذه المسودة",
  accept: "قبول",
  discard: "تجاهل",
  confidence: "ثقة النموذج",
  evidence: "الأدلة",
  aiBudget: "ميزانية الذكاء الاصطناعي",
  tokens: "رمزًا",
  percentLabel: "{label}: {value} بالمئة",
  budgetUsage: "{label}: {value} بالمئة من {limit} {unit} مستهلكة",
  resets: "تتجدد",
  budgetExhausted: "استُنفدت الميزانية — تشغيل الوكلاء متوقف حتى تتجدد النافذة أو يُرفع الحد.",
  pendingApproval: "بانتظار الموافقة",
  requestedBy: "بطلب من {who}",
  approve: "موافقة",
  reject: "رفض"
};

export const KIT_TEXT: Record<string, Record<KitKey, string>> = { en, ar };

export type KitText = (key: KitKey, vars?: Record<string, string | number>) => string;

/** Locale, then English, then the key itself — `{slot}` filled from `vars`. */
export function uiText(locale: string): KitText {
  // "ar-AE" is Arabic. Region subtags change formatting, never the catalogue.
  const table = KIT_TEXT[locale.split("-")[0] ?? "en"] ?? en;
  return (key, vars) => {
    const raw = table[key] ?? en[key];
    return vars
      ? raw.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match))
      : raw;
  };
}

const LocaleContext = React.createContext<string>("en");

/**
 * Wrap the document once. Everything below it — kit chrome, `<Money>`,
 * `<DateTime>` — picks the locale up without a prop being threaded through
 * five layers of screen.
 */
export function UiTextProvider({ locale, children }: { locale: string; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useUiLocale(): string {
  return React.useContext(LocaleContext);
}

export function useUiText(): KitText {
  return uiText(React.useContext(LocaleContext));
}
