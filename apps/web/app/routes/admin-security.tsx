import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { Badge, Card, DateTime, EmptyState, Stat, Table, type Column } from "@lyra/ui";
import { ApiError, api, fetchMe, type Problem } from "../api.server";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import { useShellData } from "./workspace";

// docs/25 admin_security — "SSO, sessions, network and rate limits".
//
// Read-only on purpose. MFA is a platform floor (packages/core/src/rbac.ts,
// `requiresMfa`: "the rule is the platform's and no tenant policy switch turns
// it off"), the session lifetime is one constant and the login throttle is two
// more. There is no tenant policy row to edit here, and inventing one would
// only offer a way to weaken the floor. So this screen reports what is enforced
// and who is currently outside it; the remedies already exist elsewhere —
// enrolment happens in the MFA flow, revocation in the staff directory, and SSO
// providers are edited in their own tab — and are linked rather than duplicated.

/* --------------------------------------------------------------- contract */

export const PERM = {
  settingsRead: "core:settings:read",
  usersRead: "core:users:read",
  providersRead: "core:identity_providers:read"
} as const;

export interface MfaGap {
  userId: string;
  email: string;
  name: string;
  roleKeys: string[];
  authProvider: string;
}

export interface ProviderRow {
  id: string;
  name: string;
  kind: string;
  emailDomain: string | null;
  enabled: boolean;
  mfaAsserted: boolean;
  defaultRoleKey: string | null;
}

export interface Posture {
  mfa: {
    policy: string;
    tenantConfigurable: boolean;
    required: number;
    enrolled: number;
    exempt: number;
    gaps: MfaGap[];
    gapsWithheld: boolean;
  };
  sessions: {
    ttlHours: number;
    tenantConfigurable: boolean;
    live: number;
    users: number;
    unverified: number;
    oldestStartedAt: number | null;
  };
  limits: { loginMax: number; loginWindowSec: number; mfaMax: number; tenantConfigurable: boolean };
  sso: { providers: ProviderRow[]; gaps: ProviderRow[] };
  network: { ipAllowlist: string };
}

/**
 * How much of the floor is actually met, as a whole percent. Nobody required is
 * full coverage, not a division by zero — a tenant of external users only is
 * covered, it just has nobody to cover.
 */
export function coverage(mfa: Pick<Posture["mfa"], "required" | "enrolled">): number {
  if (mfa.required <= 0) return 100;
  return Math.round((mfa.enrolled / mfa.required) * 100);
}

/** A provider that is live but cannot assert a second factor is the risk. */
export function providerTone(row: Pick<ProviderRow, "enabled" | "mfaAsserted">): "success" | "warning" | "neutral" {
  if (!row.enabled) return "neutral";
  return row.mfaAsserted ? "success" : "warning";
}

/* ----------------------------------------------------------------- labels */

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    title: "Security & access",
    intro: "What is enforced when someone signs in to this organisation, and who is currently outside it.",
    deniedTitle: "You cannot read security settings",
    fixed: "Enforced by the platform — not a setting",
    mfaTitle: "Second factor",
    mfaIntro:
      "Every internal role must sign in with a second factor. Partner, provider and customer sign-ins are outside that rule and are counted separately.",
    mfaCoverage: "Coverage",
    mfaRequired: "People it applies to",
    mfaEnrolled: "Enrolled",
    mfaExempt: "External sign-ins",
    gapsCaption: "People an internal role covers who have no second factor yet",
    gapsEmpty: "Everyone it applies to has enrolled.",
    gapsWithheld: "Some people have not enrolled. Naming them needs permission to read the staff directory.",
    colPerson: "Person",
    colEmail: "Sign-in address",
    colRoles: "Roles",
    colSignIn: "Sign-in method",
    staffLink: "Open the staff directory to prompt or suspend an account",
    sessionsTitle: "Sessions",
    sessionsIntro:
      "A sign-in lasts a fixed time and then has to be repeated. Suspending an account ends its sessions at the next request.",
    sessionTtl: "Session lifetime",
    sessionsLive: "Live sessions",
    sessionUsers: "People signed in",
    sessionsUnverified: "Awaiting a second factor",
    sessionsUnverifiedNote:
      "A sign-in that has not yet passed its second factor holds a session that cannot call anything. It expires with the rest.",
    sessionOldest: "Oldest still open",
    sessionNone: "Nobody is signed in right now.",
    limitsTitle: "Sign-in rate limits",
    limitsIntro: "Repeated failures are throttled per address before any password is checked.",
    loginAttempts: "Password attempts",
    loginWindow: "Per window",
    mfaAttempts: "Second-factor attempts",
    ssoTitle: "Sign-in providers",
    ssoIntro: "Single sign-on for a mail domain. A disabled provider cannot be used to sign in.",
    ssoCaption: "Configured sign-in providers",
    ssoEmpty: "No sign-in provider is configured, so everyone signs in with a password.",
    ssoGapTitle: "A live provider cannot assert a second factor",
    ssoGapBody:
      "These providers sign people in without proving a second factor was used. The platform still requires one, so the people they cover must enrol here as well.",
    colProviderName: "Provider",
    colKind: "Protocol",
    colDomain: "Mail domain",
    colState: "State",
    colSecondFactor: "Second factor",
    asserted: "Asserted",
    notAsserted: "Not asserted",
    enabled: "Enabled",
    disabled: "Disabled",
    anyDomain: "Any domain",
    ssoManage: "Add or edit providers in the sign-in providers tab",
    networkTitle: "Network",
    networkIntro:
      "There is no address allowlist to configure. Access is decided by credential and permission, not by where a request comes from, and showing an empty list here would read as though everything were allowed on purpose.",
    hours: "{n} hours",
    seconds: "{n} seconds",
    attempts: "{n} attempts",
    percent: "{n}%"
  },
  ar: {
    title: "الأمان والوصول",
    intro: "ما يُفرَض عند تسجيل الدخول إلى هذه المؤسسة، ومن هو خارج ذلك حاليًا.",
    deniedTitle: "لا يمكنك قراءة إعدادات الأمان",
    fixed: "تفرضه المنصّة — وليس إعدادًا",
    mfaTitle: "العامل الثاني",
    mfaIntro:
      "كل دور داخلي يجب أن يسجّل الدخول بعامل ثانٍ. تسجيلات الشركاء والمورّدين والعملاء خارج هذه القاعدة وتُحسب على حدة.",
    mfaCoverage: "التغطية",
    mfaRequired: "الأشخاص المشمولون",
    mfaEnrolled: "مسجّلون",
    mfaExempt: "تسجيلات خارجية",
    gapsCaption: "أشخاص يشملهم دور داخلي وليس لديهم عامل ثانٍ بعد",
    gapsEmpty: "كل من تشمله القاعدة قد سجّل عامله الثاني.",
    gapsWithheld: "بعض الأشخاص لم يسجّلوا بعد. تسميتهم تتطلب صلاحية قراءة دليل الموظفين.",
    colPerson: "الشخص",
    colEmail: "عنوان تسجيل الدخول",
    colRoles: "الأدوار",
    colSignIn: "طريقة تسجيل الدخول",
    staffLink: "افتح دليل الموظفين لتنبيه حساب أو تعليقه",
    sessionsTitle: "الجلسات",
    sessionsIntro:
      "تدوم الجلسة مدة ثابتة ثم يلزم تسجيل الدخول من جديد. تعليق الحساب ينهي جلساته عند الطلب التالي.",
    sessionTtl: "عمر الجلسة",
    sessionsLive: "جلسات نشطة",
    sessionUsers: "أشخاص مسجّلون الآن",
    sessionsUnverified: "بانتظار العامل الثاني",
    sessionsUnverifiedNote:
      "الجلسة التي لم تمرّ بعد بعاملها الثاني لا تستطيع استدعاء أي شيء، وتنتهي مع باقي الجلسات.",
    sessionOldest: "أقدم جلسة مفتوحة",
    sessionNone: "لا أحد مسجّل الدخول الآن.",
    limitsTitle: "حدود معدل تسجيل الدخول",
    limitsIntro: "تُقيَّد المحاولات الفاشلة المتكررة لكل عنوان قبل التحقق من أي كلمة مرور.",
    loginAttempts: "محاولات كلمة المرور",
    loginWindow: "خلال نافذة",
    mfaAttempts: "محاولات العامل الثاني",
    ssoTitle: "موفرو تسجيل الدخول",
    ssoIntro: "الدخول الموحّد لنطاق بريد. الموفّر المعطّل لا يمكن استخدامه لتسجيل الدخول.",
    ssoCaption: "موفرو تسجيل الدخول المهيّأون",
    ssoEmpty: "لا يوجد موفّر مهيّأ، فيسجّل الجميع الدخول بكلمة مرور.",
    ssoGapTitle: "موفّر نشط لا يؤكّد وجود عامل ثانٍ",
    ssoGapBody:
      "هؤلاء الموفرون يسجّلون الدخول دون إثبات استخدام عامل ثانٍ. المنصّة ما زالت تطلبه، فعلى من يشملونهم التسجيل هنا أيضًا.",
    colProviderName: "الموفّر",
    colKind: "البروتوكول",
    colDomain: "نطاق البريد",
    colState: "الحالة",
    colSecondFactor: "العامل الثاني",
    asserted: "مؤكَّد",
    notAsserted: "غير مؤكَّد",
    enabled: "مُفعَّل",
    disabled: "معطَّل",
    anyDomain: "أي نطاق",
    ssoManage: "أضف الموفرين أو عدّلهم في تبويب موفري تسجيل الدخول",
    networkTitle: "الشبكة",
    networkIntro:
      "لا توجد قائمة عناوين مسموح بها لتهيئتها. الوصول يُحدَّد بالاعتماد والصلاحية لا بمصدر الطلب، وعرض قائمة فارغة هنا سيُقرأ كأن كل شيء مسموح بقصد.",
    hours: "{n} ساعة",
    seconds: "{n} ثانية",
    attempts: "{n} محاولة",
    percent: "{n}٪"
  }
};

export function labelsIn(locale: string): (key: string, vars?: Record<string, string>) => string {
  const t = translator(locale);
  const table = LABELS[locale] ?? LABELS.en!;
  const fallback = LABELS.en!;
  return (key, vars) => {
    const local = table[key] ?? fallback[key];
    const shared = local ?? t(`common.${key}`);
    const raw = shared === `common.${key}` ? key : shared;
    return vars ? raw.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match) : raw;
  };
}

/* ------------------------------------------------------------------ loader */

/** A withheld read blanks one card, never the screen. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return fallback;
    throw error;
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);
  const may = {
    settingsRead: held.has(PERM.settingsRead),
    usersRead: held.has(PERM.usersRead),
    providersRead: held.has(PERM.providersRead)
  };

  const posture = may.settingsRead
    ? await safe(() => api<Posture>("/v1/core/security-posture", { env, request }), null)
    : null;

  return { may, posture, problem: null as Problem | null };
}

/* --------------------------------------------------------------- component */

export default function AdminSecurity() {
  const loaded = useLoaderData<typeof loader>();
  const shell = useShellData();
  const locale = shell?.locale ?? "en";
  const t = translator(locale);
  const l = labelsIn(locale);
  const posture = loaded.posture;

  if (!posture) {
    return (
      <div className="flex flex-col gap-6">
        <Header l={l} />
        <EmptyState title={l("deniedTitle")} body={t("error.forbidden")} />
      </div>
    );
  }

  const gapColumns: Array<Column<MfaGap>> = [
    { key: "name", header: l("colPerson"), render: (row) => row.name },
    { key: "email", header: l("colEmail"), render: (row) => <span className="font-mono text-12">{row.email}</span> },
    {
      key: "roles",
      header: l("colRoles"),
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.roleKeys.map((key) => (
            <Badge key={key} tone="neutral" size="sm">
              {key}
            </Badge>
          ))}
        </span>
      )
    },
    { key: "authProvider", header: l("colSignIn"), render: (row) => row.authProvider }
  ];

  const providerColumns: Array<Column<ProviderRow>> = [
    { key: "name", header: l("colProviderName"), render: (row) => row.name },
    { key: "kind", header: l("colKind"), render: (row) => <span className="font-mono text-12">{row.kind}</span> },
    {
      key: "emailDomain",
      header: l("colDomain"),
      render: (row) =>
        row.emailDomain ? (
          <span className="font-mono text-12">{row.emailDomain}</span>
        ) : (
          <span className="font-ui text-12 text-subtle">{l("anyDomain")}</span>
        )
    },
    {
      key: "enabled",
      header: l("colState"),
      render: (row) => (
        <Badge tone={row.enabled ? "success" : "neutral"} size="sm" dot>
          {row.enabled ? l("enabled") : l("disabled")}
        </Badge>
      )
    },
    {
      key: "mfaAsserted",
      header: l("colSecondFactor"),
      render: (row) => (
        <Badge tone={providerTone(row)} size="sm">
          {row.mfaAsserted ? l("asserted") : l("notAsserted")}
        </Badge>
      )
    }
  ];

  return (
    <div className="flex flex-col gap-6">
      <Header l={l} />

      <Card title={l("mfaTitle")} description={l("mfaIntro")}>
        <div className="flex flex-col gap-4">
          <Badge tone="info" size="sm">
            {l("fixed")}
          </Badge>
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label={l("mfaCoverage")} value={l("percent", { n: String(coverage(posture.mfa)) })} />
            <Stat label={l("mfaRequired")} value={String(posture.mfa.required)} />
            <Stat label={l("mfaEnrolled")} value={String(posture.mfa.enrolled)} />
            <Stat label={l("mfaExempt")} value={String(posture.mfa.exempt)} />
          </div>
          {posture.mfa.gapsWithheld ? (
            <p role="status" className="max-w-prose font-ui text-13 text-warning">
              {l("gapsWithheld")}
            </p>
          ) : (
            <Table
              caption={l("gapsCaption")}
              columns={gapColumns}
              rows={posture.mfa.gaps}
              rowKey={(row) => row.userId}
              empty={<EmptyState title={l("gapsEmpty")} />}
            />
          )}
          {loaded.may.usersRead ? (
            <Link to="/admin/staff" className="font-ui text-13 text-accent underline underline-offset-2">
              {l("staffLink")}
            </Link>
          ) : null}
        </div>
      </Card>

      <Card title={l("sessionsTitle")} description={l("sessionsIntro")}>
        <div className="flex flex-col gap-4">
          <Badge tone="info" size="sm">
            {l("fixed")}
          </Badge>
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label={l("sessionTtl")} value={l("hours", { n: String(posture.sessions.ttlHours) })} />
            <Stat label={l("sessionsLive")} value={String(posture.sessions.live)} />
            <Stat label={l("sessionUsers")} value={String(posture.sessions.users)} />
            <Stat label={l("sessionsUnverified")} value={String(posture.sessions.unverified)} />
          </div>
          {posture.sessions.oldestStartedAt ? (
            <p className="font-ui text-13 text-muted">
              {l("sessionOldest")}
              <span className="ms-2">
                <DateTime value={posture.sessions.oldestStartedAt} locale={locale} />
              </span>
            </p>
          ) : (
            <p className="font-ui text-13 text-subtle">{l("sessionNone")}</p>
          )}
          <p className="max-w-prose font-ui text-12 text-subtle">{l("sessionsUnverifiedNote")}</p>
        </div>
      </Card>

      <Card title={l("limitsTitle")} description={l("limitsIntro")}>
        <div className="flex flex-col gap-4">
          <Badge tone="info" size="sm">
            {l("fixed")}
          </Badge>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label={l("loginAttempts")} value={l("attempts", { n: String(posture.limits.loginMax) })} />
            <Stat label={l("loginWindow")} value={l("seconds", { n: String(posture.limits.loginWindowSec) })} />
            <Stat label={l("mfaAttempts")} value={l("attempts", { n: String(posture.limits.mfaMax) })} />
          </div>
        </div>
      </Card>

      <Card title={l("ssoTitle")} description={l("ssoIntro")}>
        <div className="flex flex-col gap-4">
          {posture.sso.gaps.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-md border border-warning/40 bg-surface-2 p-3">
              <h3 className="font-display text-14 text-text">{l("ssoGapTitle")}</h3>
              <p className="max-w-prose font-ui text-12 text-subtle">{l("ssoGapBody")}</p>
            </div>
          ) : null}
          <Table
            caption={l("ssoCaption")}
            columns={providerColumns}
            rows={posture.sso.providers}
            rowKey={(row) => row.id}
            rowState={(row) => (row.enabled ? undefined : "sealed")}
            empty={<EmptyState title={l("ssoEmpty")} />}
          />
          {loaded.may.providersRead ? (
            <Link to="/admin/identity-providers" className="font-ui text-13 text-accent underline underline-offset-2">
              {l("ssoManage")}
            </Link>
          ) : null}
        </div>
      </Card>

      <Card title={l("networkTitle")}>
        <p className="max-w-prose font-ui text-13 text-muted">{l("networkIntro")}</p>
      </Card>
    </div>
  );
}

function Header({ l }: { l: (key: string) => string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="font-serif text-24 leading-[1.2] text-text">{l("title")}</h1>
      <p className="max-w-prose font-ui text-13 text-muted">{l("intro")}</p>
    </header>
  );
}
