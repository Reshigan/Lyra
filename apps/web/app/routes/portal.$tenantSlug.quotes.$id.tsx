import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction
} from "react-router";
import { Badge, Button, Card, Field, Money } from "@lyra/ui";
import { cloudflare } from "../context";
import type { ReactNode } from "react";
import { ApiError, api, asRouteError, type Brand } from "../api.server";
import { DEFAULT_LOCALE, localeFrom, pseudoText } from "../i18n";
import { brandStyle } from "../components/shell";

// J-C1 "Get covered", customer half (docs/06). The visitor has no session — the
// one-time token in the URL is the whole credential — so this page never shows
// anything the API would not hand a stranger holding that link: no commission,
// no provider scoring, no decline reasons. What it does show is the ranking
// criterion, because a comparison that hides how it sorted is the thing the
// journey is written against.
//
// There is no payment step. No PSP connector exists (apps/api engines/settlement
// §7) and binding cover is `consequential: true` (CLAUDE.md §4), so the last
// thing the customer does here is send documents; a human approves issuance.
// ADR-0043.

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    "quote.title": "Your quotes",
    "quote.intro": "Prices are held for you. Keep this link — it is the only way back to this comparison.",
    "quote.rankedBy": "{n} offer(s), ranked by total price, cheapest first.",
    "quote.total": "Total payable",
    "quote.premium": "Premium",
    "quote.tax": "Tax",
    "quote.fees": "Fees",
    "quote.cheapest": "Cheapest",
    "quote.excess": "Excess",
    "quote.agencyRepair": "Agency repair",
    "quote.roadside": "Roadside assistance",
    "quote.included": "Included",
    "quote.notIncluded": "Not included",
    "quote.validUntil": "Held until",
    "quote.choose": "Choose this cover",
    "quote.choosing": "Saving…",
    "quote.chosen": "Chosen",
    "quote.referred": "{n} more underwriter(s) are quoting by hand. We will email you when they answer.",
    "quote.empty": "No underwriter could price this online. We will call you.",
    "quote.expired": "These prices have expired. Please start a new quote.",
    "quote.accepted.title": "Next: send your documents",
    "quote.accepted.body":
      "Nothing is bound yet. Upload your ID and licence and one of our people will check the cover and confirm it with you.",
    "quote.upload": "Document (JPEG, PNG, HEIC or PDF, up to 10MB)",
    "quote.upload.submit": "Upload document",
    "quote.upload.working": "Uploading…",
    "quote.upload.done": "Received. Upload another if you have one.",
    "quote.upload.error.type": "That file type is not accepted.",
    "quote.error.generic": "Something went wrong. Please try again.",
    "quote.back": "Back to products"
  },
  ar: {
    "quote.title": "عروض الأسعار الخاصة بك",
    "quote.intro": "الأسعار محجوزة لك. احتفظ بهذا الرابط — فهو الطريقة الوحيدة للعودة إلى هذه المقارنة.",
    "quote.rankedBy": "{n} عرض(عروض)، مرتبة حسب السعر الإجمالي، الأرخص أولًا.",
    "quote.total": "الإجمالي المستحق",
    "quote.premium": "القسط",
    "quote.tax": "الضريبة",
    "quote.fees": "الرسوم",
    "quote.cheapest": "الأرخص",
    "quote.excess": "التحمل",
    "quote.agencyRepair": "إصلاح الوكالة",
    "quote.roadside": "المساعدة على الطريق",
    "quote.included": "مشمول",
    "quote.notIncluded": "غير مشمول",
    "quote.validUntil": "محجوز حتى",
    "quote.choose": "اختر هذه التغطية",
    "quote.choosing": "جارٍ الحفظ…",
    "quote.chosen": "تم الاختيار",
    "quote.referred": "هناك {n} شركة تأمين تسعّر يدويًا. سنراسلك عند ورود ردها.",
    "quote.empty": "لم تتمكن أي شركة من التسعير عبر الإنترنت. سنتصل بك.",
    "quote.expired": "انتهت صلاحية هذه الأسعار. يرجى بدء طلب جديد.",
    "quote.accepted.title": "الخطوة التالية: أرسل مستنداتك",
    "quote.accepted.body":
      "لم يتم إصدار الوثيقة بعد. حمّل هويتك ورخصتك وسيتحقق أحد موظفينا من التغطية ويؤكدها معك.",
    "quote.upload": "مستند (JPEG أو PNG أو HEIC أو PDF، حتى ١٠ ميغابايت)",
    "quote.upload.submit": "رفع المستند",
    "quote.upload.working": "جارٍ الرفع…",
    "quote.upload.done": "تم الاستلام. ارفع مستندًا آخر إن وجد.",
    "quote.upload.error.type": "نوع الملف غير مقبول.",
    "quote.error.generic": "حدث خطأ ما. حاول مرة أخرى.",
    "quote.back": "العودة إلى المنتجات"
  }
};

function labeller(locale: string): (key: string) => string {
  const table = LABELS[locale] ?? LABELS[DEFAULT_LOCALE];
  return (key) => pseudoText(locale, table?.[key] ?? LABELS[DEFAULT_LOCALE]?.[key] ?? key);
}

/**
 * The ranking line under the hero title. Real count off the comparison the
 * loader just fetched, not shown at all once there is nothing to rank — the
 * empty state below already says why.
 */
export function quoteRankingLede(l: (key: string) => string, offerCount: number): string | null {
  return offerCount > 0 ? l("quote.rankedBy").replace("{n}", String(offerCount)) : null;
}

interface Offer {
  offeringId: string;
  name: string;
  providerName: string | null;
  premiumMinor: number;
  taxMinor: number;
  feesMinor: number;
  totalMinor: number;
  currency: string;
  coverage: Record<string, unknown> | null;
  rank: number | null;
  validUntil: number | null;
}

interface Comparison {
  state: string;
  currency: string;
  rankedBy: "total_price";
  acceptedOfferingId: string | null;
  referredCount: number;
  offers: Offer[];
}

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const tenantSlug = params.tenantSlug!;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const [site, comparison] = await Promise.all([
    api<{ tenant: { name: string; brand: Brand } }>(`/v1/portal/${tenantSlug}/site`, { env, request }),
    api<Comparison>(
      `/v1/portal/${tenantSlug}/quote-requests/${params.id}?token=${encodeURIComponent(token)}`,
      { env, request }
    )
  ]).catch(asRouteError);
  return { locale: localeFrom(request), tenantSlug, tenant: site.tenant, comparison };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData: loaded }) => [
  { title: loaded ? `${loaded.tenant.name} — quotes` : "" }
];

type ActionData = { intent: "accept" | "document"; ok: boolean; errorKey?: string };

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const tenantSlug = params.tenantSlug!;
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const intent = form.get("intent") === "document" ? "document" : "accept";

  try {
    if (intent === "accept") {
      await api(`/v1/portal/${tenantSlug}/quote-requests/${params.id}/accept`, {
        env,
        method: "POST",
        body: { token, offeringId: String(form.get("offeringId") ?? "") }
      });
    } else {
      // Multipart, so it cannot go through `api()` (JSON only). The file is
      // streamed straight back out rather than buffered into a JSON envelope.
      const upload = new FormData();
      upload.append("token", token);
      upload.append("file", form.get("file") as Blob);
      const response = await fetch(
        new URL(`/v1/portal/${tenantSlug}/quote-requests/${params.id}/documents`, env.API_ORIGIN),
        { method: "POST", body: upload }
      );
      if (!response.ok) throw await ApiError.from(response, "documents");
    }
    return { intent, ok: true } satisfies ActionData;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const errorKey =
      error.status === 409
        ? "quote.expired"
        : error.status === 400 && intent === "document"
          ? "quote.upload.error.type"
          : "quote.error.generic";
    return { intent, ok: false, errorKey } satisfies ActionData;
  }
}

function coverageLine(l: (key: string) => string, coverage: Record<string, unknown> | null, currency: string) {
  if (!coverage) return null;
  const parts: ReactNode[] = [];
  if (typeof coverage.excessMinor === "number") {
    parts.push(
      <span key="excess">
        {l("quote.excess")} <Money amountMinor={coverage.excessMinor} currency={currency} />
      </span>
    );
  }
  for (const key of ["agencyRepair", "roadside"] as const) {
    if (typeof coverage[key] === "boolean") {
      parts.push(
        <span key={key}>
          {l(`quote.${key}`)}: {coverage[key] ? l("quote.included") : l("quote.notIncluded")}
        </span>
      );
    }
  }
  return parts.length ? <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-13 text-muted">{parts}</div> : null;
}

export default function PortalQuotes() {
  const { locale, tenantSlug, tenant, comparison } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const result = useActionData<ActionData>();
  const navigation = useNavigation();
  const l = labeller(locale);
  const token = searchParams.get("token") ?? "";
  const busy = navigation.state !== "idle";
  const accepted = comparison.acceptedOfferingId;
  const rankingLede = quoteRankingLede(l, comparison.offers.length);

  return (
    <main style={brandStyle(tenant.brand)} className="lyra-field min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-3xl p-6">
        <header className="lyra-enter mb-8 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="font-serif text-22 leading-[1.2] text-text">{l("quote.title")}</h1>
            <p className="font-ui text-13 text-muted">{l("quote.intro")}</p>
            {/* Declared criteria, visible — J-C1's own wording. */}
            {rankingLede ? <p className="font-ui text-13 text-muted">{rankingLede}</p> : null}
            <a className="w-fit font-ui text-13 text-accent underline" href={`/portal/${tenantSlug}`}>
              {l("quote.back")}
            </a>
          </div>
        </header>

        {result?.errorKey ? (
          <p role="alert" className="mb-4 text-13 text-danger">
            {l(result.errorKey)}
          </p>
        ) : null}

        {comparison.offers.length === 0 ? (
          <p className="text-14 text-muted">{l("quote.empty")}</p>
        ) : (
          <ol className="lyra-stagger grid gap-4">
            {comparison.offers.map((offer) => (
              <li key={offer.offeringId}>
                <Card
                  title={offer.name}
                  description={offer.providerName ?? undefined}
                  actions={
                    offer.rank === 1 ? <Badge tone="accent">{l("quote.cheapest")}</Badge> : undefined
                  }
                >
                  <p className="text-13 text-muted">{l("quote.total")}</p>
                  <p className="font-serif text-22 leading-[1.2]">
                    <Money amountMinor={offer.totalMinor} currency={offer.currency} locale={locale} />
                  </p>
                  <p className="mt-1 text-13 text-muted">
                    {l("quote.premium")} <Money amountMinor={offer.premiumMinor} currency={offer.currency} /> ·{" "}
                    {l("quote.tax")} <Money amountMinor={offer.taxMinor} currency={offer.currency} />
                    {offer.feesMinor > 0 ? (
                      <>
                        {" · "}
                        {l("quote.fees")} <Money amountMinor={offer.feesMinor} currency={offer.currency} />
                      </>
                    ) : null}
                  </p>
                  {coverageLine(l, offer.coverage, offer.currency)}
                  {offer.validUntil ? (
                    <p className="mt-3 text-13 text-muted">
                      {l("quote.validUntil")}{" "}
                      {new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(offer.validUntil))}
                    </p>
                  ) : null}

                  {accepted === offer.offeringId ? (
                    <p className="mt-4 text-13 text-success">{l("quote.chosen")}</p>
                  ) : (
                    <Form method="post" className="mt-4">
                      <input type="hidden" name="intent" value="accept" />
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="offeringId" value={offer.offeringId} />
                      <Button type="submit" variant={accepted ? "secondary" : "primary"} loading={busy}>
                        {busy ? l("quote.choosing") : l("quote.choose")}
                      </Button>
                    </Form>
                  )}
                </Card>
              </li>
            ))}
          </ol>
        )}

        {comparison.referredCount > 0 ? (
          <p className="mt-4 text-13 text-muted">
            {l("quote.referred").replace("{n}", String(comparison.referredCount))}
          </p>
        ) : null}

        {accepted ? (
          <Card className="mt-8" title={l("quote.accepted.title")}>
            <p className="text-14">{l("quote.accepted.body")}</p>
            {result?.intent === "document" && result.ok ? (
              <p role="status" className="mt-3 text-13 text-success">
                {l("quote.upload.done")}
              </p>
            ) : null}
            <Form method="post" encType="multipart/form-data" className="mt-4 flex flex-col gap-3">
              <input type="hidden" name="intent" value="document" />
              <input type="hidden" name="token" value={token} />
              <Field label={l("quote.upload")} id="quote-file">
                <input
                  id="quote-file"
                  type="file"
                  name="file"
                  required
                  accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"
                  className="text-13"
                />
              </Field>
              <Button type="submit" variant="primary" loading={busy}>
                {busy ? l("quote.upload.working") : l("quote.upload.submit")}
              </Button>
            </Form>
          </Card>
        ) : null}

        <footer className="mt-10 border-t border-border pt-4 text-13">
          <a className="text-accent underline" href={`/portal/${tenantSlug}`}>
            {l("quote.back")}
          </a>
        </footer>
      </div>
    </main>
  );
}
