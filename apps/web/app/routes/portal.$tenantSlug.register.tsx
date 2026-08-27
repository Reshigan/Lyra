import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction
} from "react-router";
import { Button, Card, Checkbox, Field, Input } from "@lyra/ui";
import { cloudflare } from "../context";
import { ApiError, api, asRouteError, invalidFields, type Brand } from "../api.server";
import { DEFAULT_LOCALE, localeFrom, pseudoText } from "../i18n";
import { brandStyle } from "../components/shell";
import { Turnstile } from "../components/turnstile";

// Self-registration on the public storefront (docs/06 J-C4's neighbour: the
// door a customer walks through before there is anything to look at). It is the
// most exposed write surface in the product — no session, no tenant-scoped
// caller, a URL anyone can find — so what it can create is deliberately tiny:
// `POST /v1/portal/:tenantSlug/registrations` records a customer at
// kyc_status=pending with a consent record, and grants nothing. No user, no
// session, no key, no role. Access is a `consequential` decision (CLAUDE.md §4)
// and is made by a human on the staff side.
//
// Which tenant, which role, which entitlements: none of the three is in this
// form, and none of them can be. The slug in the path selects an *active*
// tenant server-side; everything else the visitor sends is a name and a way to
// reach them.

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    "register.title": "Create an account",
    "register.intro":
      "Tell us who you are and we will set you up. Registering does not sign you in and does not buy anything — one of our people checks it and comes back to you.",
    "register.kind.person": "For myself",
    "register.kind.business": "For a business",
    "register.name": "Full name",
    "register.companyName": "Registered company name",
    "register.contactName": "Your name",
    "register.email": "Email",
    "register.phone": "Phone (optional)",
    "register.registrationNo": "Company registration number (optional)",
    "register.taxId": "Tax number (optional)",
    "register.country": "Country of registration (2-letter code, optional)",
    "register.consent": "I agree to be contacted about this registration.",
    "register.submit": "Register",
    "register.working": "Sending…",
    "register.done.title": "Thank you — we have your details",
    "register.done.body":
      "Nothing is active yet. We check every registration by hand and will email you at the address you gave us.",
    "register.again": "Register someone else",
    "register.error.throttled": "Too many registrations from here — try again tomorrow.",
    "register.error.challenge": "The security check did not pass. Reload the page and try again.",
    "register.error.validation": "Check the highlighted fields and try again.",
    "register.error.field": "This needs correcting.",
    "register.error.generic": "Something went wrong. Please try again.",
    "register.back": "Back to products"
  },
  ar: {
    "register.title": "إنشاء حساب",
    "register.intro":
      "أخبرنا من أنت وسنهيّئ لك الحساب. التسجيل لا يسجّل دخولك ولا يشتري شيئًا — يراجعه أحد موظفينا ويعود إليك.",
    "register.kind.person": "لنفسي",
    "register.kind.business": "لشركة",
    "register.name": "الاسم الكامل",
    "register.companyName": "اسم الشركة المسجل",
    "register.contactName": "اسمك",
    "register.email": "البريد الإلكتروني",
    "register.phone": "الهاتف (اختياري)",
    "register.registrationNo": "رقم السجل التجاري (اختياري)",
    "register.taxId": "الرقم الضريبي (اختياري)",
    "register.country": "بلد التسجيل (رمز من حرفين، اختياري)",
    "register.consent": "أوافق على التواصل معي بخصوص هذا التسجيل.",
    "register.submit": "تسجيل",
    "register.working": "جارٍ الإرسال…",
    "register.done.title": "شكرًا — استلمنا بياناتك",
    "register.done.body":
      "لا شيء مُفعّل بعد. نراجع كل تسجيل يدويًا وسنراسلك على البريد الذي أدخلته.",
    "register.again": "تسجيل شخص آخر",
    "register.error.throttled": "تسجيلات كثيرة من هنا — حاول غدًا.",
    "register.error.challenge": "لم يجتز فحص الأمان. أعد تحميل الصفحة وحاول مرة أخرى.",
    "register.error.validation": "تحقق من الحقول المحددة وحاول مرة أخرى.",
    "register.error.field": "يحتاج هذا إلى تصحيح.",
    "register.error.generic": "حدث خطأ ما. حاول مرة أخرى.",
    "register.back": "العودة إلى المنتجات"
  }
};

function labeller(locale: string): (key: string) => string {
  const table = LABELS[locale] ?? LABELS[DEFAULT_LOCALE];
  return (key) => pseudoText(locale, table?.[key] ?? LABELS[DEFAULT_LOCALE]?.[key] ?? key);
}

/** Mirrors `tenant` on `GET /v1/portal/{tenantSlug}/site` — apps/api/src/routes/portal.ts §site. */
interface SiteResponse {
  tenant: { name: string; brand: Brand; domainPack?: string };
}

/** person | business, and nothing else is a valid answer. Anything unrecognised
 *  in the query string is a person, which is the narrower of the two. */
export function registrationKind(raw: string | null): "person" | "business" {
  return raw === "business" ? "business" : "person";
}

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const tenantSlug = params.tenantSlug!;
  const site = await api<SiteResponse>(`/v1/portal/${tenantSlug}/site`, { env, request }).catch(asRouteError);
  return {
    locale: localeFrom(request),
    tenantSlug,
    tenant: site.tenant,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData: loaded }) => [
  { title: loaded ? `${loaded.tenant.name} — register` : "" }
];

/**
 * `invalid` names the inputs the API rejected, so the reader is pointed at the
 * field to correct instead of being told only that "something" was invalid.
 * An array rather than a Set because this crosses the action boundary.
 */
type ActionData = { ok: boolean; errorKey?: string; invalid?: string[] };

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const tenantSlug = params.tenantSlug!;
  const form = await request.formData();
  const kind = registrationKind(String(form.get("kind") ?? ""));

  // The API takes `.strict()` objects with `.min(1)` on every optional string,
  // so a blank box has to be omitted rather than sent as "".
  const optional = (name: string) => {
    const value = String(form.get(name) ?? "").trim();
    return value ? { [name]: value } : {};
  };
  const shared = {
    email: String(form.get("email") ?? "").trim(),
    ...optional("phone"),
    // Which locale to write to them in, not which tenant or role to give them.
    locale: String(form.get("locale") ?? "") === "ar" ? "ar" : "en",
    consent: form.get("consent") === "on",
    ...(form.get("cf-turnstile-response") ? { turnstileToken: String(form.get("cf-turnstile-response")) } : {})
  };

  try {
    await api(`/v1/portal/${tenantSlug}/registrations`, {
      env,
      method: "POST",
      body:
        kind === "business"
          ? {
              kind,
              companyName: String(form.get("companyName") ?? "").trim(),
              contactName: String(form.get("contactName") ?? "").trim(),
              ...optional("registrationNo"),
              ...optional("taxId"),
              ...optional("country"),
              ...shared
            }
          : { kind, name: String(form.get("name") ?? "").trim(), ...shared }
    });
    // The reply carries `{status:"pending"}` and no handle — there is nothing
    // to keep, so nothing is kept.
    return { ok: true } satisfies ActionData;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const errorKey =
      error.status === 429
        ? "register.error.throttled"
        : error.status === 403
          ? "register.error.challenge"
          : error.status === 400
            ? "register.error.validation"
            : "register.error.generic";
    return { ok: false, errorKey, invalid: [...invalidFields(error.problem)] } satisfies ActionData;
  }
}

export default function PortalRegister() {
  const { locale, tenantSlug, tenant, turnstileSiteKey } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const result = useActionData<ActionData>();
  const navigation = useNavigation();
  const l = labeller(locale);
  const busy = navigation.state !== "idle";
  // The chooser is a pair of links, not client state: a visitor with no
  // JavaScript still reaches the business form, and the URL is shareable.
  const kind = registrationKind(searchParams.get("kind"));
  // The API names the fields it rejected; its zod messages are English-only, so
  // the wording is ours and only the placement comes from the API.
  const invalid = new Set(result?.invalid ?? []);
  const bad = (name: string) => (invalid.has(name) ? l("register.error.field") : undefined);

  const tab = (value: "person" | "business") => (
    <Link
      key={value}
      to={`/portal/${tenantSlug}/register?kind=${value}`}
      aria-current={kind === value ? "page" : undefined}
      className={
        kind === value
          ? "rounded-sm border border-accent bg-accent px-3 py-2 font-ui text-14 text-accent-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          : "rounded-sm border border-border px-3 py-2 font-ui text-14 text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      }
    >
      {l(`register.kind.${value}`)}
    </Link>
  );

  return (
    <main style={brandStyle(tenant.brand)} className="lyra-field min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-2xl p-6">
        <header className="lyra-enter mb-8 flex flex-col gap-1">
          <h1 className="font-serif text-36 leading-[1.15] text-text">{tenant.name}</h1>
          <p className="font-ui text-16 text-muted">{l("register.title")}</p>
        </header>

        {result?.ok ? (
          <Card title={l("register.done.title")}>
            <p role="status" className="text-14">
              {l("register.done.body")}
            </p>
            <p className="mt-4 text-13">
              <Link className="text-accent underline" to={`/portal/${tenantSlug}/register?kind=${kind}`} reloadDocument>
                {l("register.again")}
              </Link>
            </p>
          </Card>
        ) : (
          <Card title={l("register.title")} description={l("register.intro")}>
            <div className="mb-5 flex flex-wrap gap-2">{[tab("person"), tab("business")]}</div>
            <Form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="locale" value={locale} />
              {kind === "business" ? (
                <>
                  <Field label={l("register.companyName")} id="register-company" error={bad("companyName")} required>
                    <Input name="companyName" required minLength={2} maxLength={200} autoComplete="organization" />
                  </Field>
                  <Field label={l("register.contactName")} id="register-contact" error={bad("contactName")} required>
                    <Input name="contactName" required maxLength={200} autoComplete="name" />
                  </Field>
                  <Field label={l("register.registrationNo")} id="register-registration-no" error={bad("registrationNo")}>
                    <Input name="registrationNo" maxLength={80} autoComplete="off" spellCheck={false} />
                  </Field>
                  <Field label={l("register.taxId")} id="register-tax-id" error={bad("taxId")}>
                    <Input name="taxId" maxLength={80} autoComplete="off" spellCheck={false} />
                  </Field>
                  <Field label={l("register.country")} id="register-country" error={bad("country")}>
                    {/* ISO 3166-1 alpha-2. Two characters is the column, so the
                        pattern refuses "United Arab Emirates" here rather than
                        after a round trip. */}
                    <Input
                      name="country"
                      maxLength={2}
                      pattern="[A-Za-z]{2}"
                      autoComplete="country"
                      autoCapitalize="characters"
                      spellCheck={false}
                      className="w-24"
                    />
                  </Field>
                </>
              ) : (
                <Field label={l("register.name")} id="register-name" error={bad("name")} required>
                  <Input name="name" required maxLength={200} autoComplete="name" />
                </Field>
              )}
              <Field label={l("register.email")} id="register-email" error={bad("email")} required>
                <Input name="email" type="email" required autoComplete="email" />
              </Field>
              <Field label={l("register.phone")} id="register-phone" error={bad("phone")}>
                <Input name="phone" type="tel" maxLength={40} autoComplete="tel" />
              </Field>
              <Checkbox name="consent" required label={l("register.consent")} />
              {result?.errorKey ? (
                <p role="alert" className="text-13 text-danger">
                  {l(result.errorKey)}
                </p>
              ) : null}
              <Turnstile siteKey={turnstileSiteKey} locale={locale} />
              <Button type="submit" variant="primary" loading={busy}>
                {busy ? l("register.working") : l("register.submit")}
              </Button>
            </Form>
          </Card>
        )}

        <footer className="mt-10 border-t border-border pt-4 text-13">
          <Link className="text-accent underline" to={`/portal/${tenantSlug}`}>
            {l("register.back")}
          </Link>
        </footer>
      </div>
    </main>
  );
}
