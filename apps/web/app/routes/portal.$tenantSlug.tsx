import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction
} from "react-router";
import { Badge, Button, Card, Checkbox, Field, Input, Textarea } from "@lyra/ui";
import { cloudflare } from "../context";
import { ApiError, api, asRouteError, type Brand } from "../api.server";
import { DEFAULT_LOCALE, localeFrom } from "../i18n";
import { optionLabel } from "../modules/spec";
import { brandStyle } from "../components/shell";

// The public comparison site (yallacompare-style, docs/decisions/ADR-0030). No
// session, no tenant-scoped caller — a lead can land here from an ad with
// nothing but the tenant's slug in the URL, so every string on the page is
// either the tenant's own brand data or this file's bilingual copy; there is
// no shared workspace catalogue to borrow from and no `:module` spec to route
// through.

const LABELS: Record<string, Record<string, string>> = {
  en: {
    "portal.intro": "Compare products and get a quote in minutes.",
    "portal.empty": "No products are available for comparison right now.",
    "portal.quote": "Get a quote",
    "portal.form.name": "Full name",
    "portal.form.email": "Email",
    "portal.form.phone": "Phone (optional)",
    "portal.form.message": "Anything we should know? (optional)",
    "portal.form.consent": "I agree to be contacted about this quote.",
    "portal.form.submit": "Request quote",
    "portal.form.working": "Sending…",
    "portal.form.success": "Thanks — we've received your request and will be in touch.",
    "portal.form.error.validation": "Check the highlighted fields and try again.",
    "portal.form.error.throttled": "Too many requests from this email — try again later.",
    "portal.form.error.generic": "Something went wrong. Please try again.",
    "line.motor": "Motor",
    "line.health": "Health",
    "line.travel": "Travel",
    "line.home": "Home",
    "line.life": "Life",
    "line.sme": "SME",
    "line.card": "Card",
    "line.loan": "Loan",
    "line.account": "Account"
  },
  ar: {
    "portal.intro": "قارن المنتجات واحصل على عرض سعر خلال دقائق.",
    "portal.empty": "لا توجد منتجات متاحة للمقارنة حاليًا.",
    "portal.quote": "احصل على عرض سعر",
    "portal.form.name": "الاسم الكامل",
    "portal.form.email": "البريد الإلكتروني",
    "portal.form.phone": "الهاتف (اختياري)",
    "portal.form.message": "هل هناك ما تود إخبارنا به؟ (اختياري)",
    "portal.form.consent": "أوافق على التواصل معي بخصوص هذا العرض.",
    "portal.form.submit": "طلب عرض سعر",
    "portal.form.working": "جارٍ الإرسال…",
    "portal.form.success": "شكرًا — استلمنا طلبك وسنتواصل معك قريبًا.",
    "portal.form.error.validation": "تحقق من الحقول المحددة وحاول مرة أخرى.",
    "portal.form.error.throttled": "طلبات كثيرة من هذا البريد — حاول لاحقًا.",
    "portal.form.error.generic": "حدث خطأ ما. حاول مرة أخرى.",
    "line.motor": "السيارات",
    "line.health": "الصحة",
    "line.travel": "السفر",
    "line.home": "المنزل",
    "line.life": "الحياة",
    "line.sme": "الشركات الصغيرة",
    "line.card": "البطاقات",
    "line.loan": "القروض",
    "line.account": "الحسابات"
  }
};

function labeller(locale: string): (key: string) => string {
  const table = LABELS[locale] ?? LABELS[DEFAULT_LOCALE];
  return (key) => table?.[key] ?? LABELS[DEFAULT_LOCALE]?.[key] ?? key;
}

interface Product {
  id: string;
  line: string;
  name: string;
  providerName: string | null;
}

interface SiteResponse {
  tenant: { name: string; brand: Brand };
  products: Product[];
}

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const tenantSlug = params.tenantSlug!;
  const site = await api<SiteResponse>(`/v1/portal/${tenantSlug}/site`, { env, request }).catch(asRouteError);
  return { locale: localeFrom(request), tenantSlug, site };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData: loaded }) => [
  { title: loaded?.site.tenant.name ?? "" }
];

type ActionData = {
  productId: string;
  ok: boolean;
  errorKey?: string;
};

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const tenantSlug = params.tenantSlug!;
  const form = await request.formData();
  const productId = String(form.get("productId") ?? "");

  try {
    await api(`/v1/portal/${tenantSlug}/leads`, {
      env,
      method: "POST",
      body: {
        productId,
        name: String(form.get("name") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
        ...(form.get("phone") ? { phone: String(form.get("phone")).trim() } : {}),
        ...(form.get("message") ? { message: String(form.get("message")).trim() } : {}),
        consent: form.get("consent") === "on"
      }
    });
    return { productId, ok: true } satisfies ActionData;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const errorKey =
      error.status === 429
        ? "portal.form.error.throttled"
        : error.status === 400
          ? "portal.form.error.validation"
          : "portal.form.error.generic";
    return { productId, ok: false, errorKey } satisfies ActionData;
  }
}

export default function Portal() {
  const { locale, site } = useLoaderData<typeof loader>();
  const result = useActionData<ActionData>();
  const navigation = useNavigation();
  const l = labeller(locale);
  const busy = navigation.state !== "idle";

  return (
    <main style={brandStyle(site.tenant.brand)} className="mx-auto max-w-4xl p-6">
      <header className="mb-8 flex items-center gap-3">
        {site.tenant.brand.logo?.light ?? site.tenant.brand.logo?.mark ? (
          <img
            src={site.tenant.brand.logo?.light ?? site.tenant.brand.logo?.mark}
            alt={site.tenant.name}
            className="h-10 w-auto"
          />
        ) : null}
        <div>
          <h1 className="font-serif text-24 leading-[1.2]">{site.tenant.name}</h1>
          <p className="mt-1 text-13 text-muted">{l("portal.intro")}</p>
        </div>
      </header>

      {site.products.length === 0 ? (
        <p className="text-14 text-muted">{l("portal.empty")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {site.products.map((product) => {
            const submitted = result?.productId === product.id ? result : undefined;
            return (
              <Card
                key={product.id}
                title={product.name}
                description={product.providerName ?? undefined}
                actions={
                  <Badge tone="accent">{optionLabel(l, "line", product.line)}</Badge>
                }
              >
                {submitted?.ok ? (
                  <p role="status" className="text-13 text-success">
                    {l("portal.form.success")}
                  </p>
                ) : (
                  <details>
                    <summary className="cursor-pointer text-13 font-medium text-accent">
                      {l("portal.quote")}
                    </summary>
                    <Form method="post" className="mt-4 flex flex-col gap-3">
                      <input type="hidden" name="productId" value={product.id} />
                      {submitted?.errorKey ? (
                        <p role="alert" className="text-13 text-danger">
                          {l(submitted.errorKey)}
                        </p>
                      ) : null}
                      <Field label={l("portal.form.name")} id={`name-${product.id}`}>
                        <Input name="name" autoComplete="name" required />
                      </Field>
                      <Field label={l("portal.form.email")} id={`email-${product.id}`}>
                        <Input name="email" type="email" autoComplete="email" required />
                      </Field>
                      <Field label={l("portal.form.phone")} id={`phone-${product.id}`}>
                        <Input name="phone" type="tel" autoComplete="tel" />
                      </Field>
                      <Field label={l("portal.form.message")} id={`message-${product.id}`}>
                        <Textarea name="message" rows={3} />
                      </Field>
                      <Checkbox name="consent" required label={l("portal.form.consent")} />
                      <Button type="submit" variant="primary" loading={busy}>
                        {busy ? l("portal.form.working") : l("portal.form.submit")}
                      </Button>
                    </Form>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
