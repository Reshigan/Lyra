import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { Badge, Card, DateTime, EmptyState, Money, Ref, Stat, Table, type Column } from "@lyra/ui";
import { api, fetchMe, names } from "../api.server";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import {
  Entry,
  Facts,
  Header,
  Payload,
  labelsFrom,
  nameOf,
  percentOf,
  rowsOf,
  safe,
  tag,
  type Page
} from "./detail-kit";
import { useShellData } from "./workspace";

// One product definition: what it covers, what prices it, which underwriter
// versions exist, and which channels are allowed to sell them. Read-only — the
// generic record screen already owns the edit form, so this one only reads
// (ponytail: no action(), the write path exists at /admin/products/:id).

/* --------------------------------------------------------------- contract */

export interface Product {
  id: string;
  line: string;
  nameJson?: unknown;
  providerId?: string | null;
  termsRef?: string | null;
  status: string;
  structure: string;
  takafulJson?: unknown;
  parametricTriggerJson?: unknown;
  standardMappingJson?: unknown;
  pricingInputsJson?: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface OfferingRow {
  id: string;
  providerId: string;
  code: string;
  nameJson?: unknown;
  currency: string;
  pricingMode: string;
  ratingInputsJson?: unknown;
  coverageJson?: unknown;
  baseCommissionPpm: number;
  minPremiumMinor?: number | null;
  channelKeysJson?: unknown;
  status: string;
  effectiveFrom: number;
  effectiveTo?: number | null;
}

export interface ChannelRow {
  id: string;
  key: string;
  kind: string;
  nameJson?: unknown;
  status: string;
  defaultCommissionPpm?: number | null;
}

export const PERM = {
  read: "core:products:read",
  offerings: "dist:offerings:read",
  channels: "dist:channels:read"
} as const;

/* ---------------------------------------------------------------- labels */

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    intro: "What this covers, what prices it, and who is allowed to sell it.",
    back: "Back to the catalogue",
    definitionTitle: "Definition",
    line: "Line",
    structure: "Structure",
    provider: "Owning underwriter",
    terms: "Wording reference",
    versionCount: "Versions",
    channelCount: "Distributing",
    pricingTitle: "Rating inputs",
    pricingCaption: "What a price for this product has to be told before it can be quoted.",
    coverTitle: "Cover components",
    coverCaption: "The limits and benefits each underwriter version carries.",
    takafulTitle: "Takaful terms",
    parametricTitle: "Parametric trigger",
    mappingTitle: "Standard mapping",
    versionsTitle: "Underwriter versions",
    versionsCaption: "Every underwriter version of this product, and the commission it pays.",
    channelsTitle: "Sold through",
    channelsCaption: "Channels allowed to distribute a version of this product.",
    channelsAll: "Every channel may sell this: no version restricts it.",
    colOffering: "Version",
    colProvider: "Underwriter",
    colPricing: "Priced by",
    colCommission: "Commission",
    colEffective: "From",
    colChannel: "Channel",
    colChannelKind: "Kind",
    colDefaultShare: "Default share",
    unnamed: "Unnamed",
    "line.motor": "Motor",
    "line.health": "Health",
    "line.travel": "Travel",
    "line.home": "Home",
    "line.life": "Life",
    "line.sme": "Small business",
    "line.card": "Card",
    "line.loan": "Loan",
    "line.account": "Account",
    "structure.conventional": "Conventional",
    "structure.takaful": "Takaful",
    "structure.parametric": "Parametric",
    "pricingMode.api": "Live interface",
    "pricingMode.table": "Rate table",
    "pricingMode.manual": "By hand",
    "pricingMode.referral": "Referral",
    "kind.b2c": "Direct",
    "kind.b2b": "Partner"
  },
  ar: {
    intro: "ما يغطّيه هذا المنتج، وما يحدّد سعره، ومن يحق له بيعه.",
    back: "العودة إلى الكتالوج",
    definitionTitle: "التعريف",
    line: "الخط",
    structure: "البنية",
    provider: "جهة الاكتتاب المالكة",
    terms: "مرجع الصيغة",
    versionCount: "الإصدارات",
    channelCount: "قنوات التوزيع",
    pricingTitle: "مدخلات التسعير",
    pricingCaption: "ما يجب معرفته قبل إمكانية تسعير هذا المنتج.",
    coverTitle: "عناصر التغطية",
    coverCaption: "الحدود والمزايا في كل إصدار من إصدارات جهات الاكتتاب.",
    takafulTitle: "أحكام التكافل",
    parametricTitle: "محرّك التعويض البارامتري",
    mappingTitle: "الربط المعياري",
    versionsTitle: "إصدارات جهات الاكتتاب",
    versionsCaption: "كل إصدار لهذا المنتج، والعمولة التي يدفعها.",
    channelsTitle: "قنوات البيع",
    channelsCaption: "القنوات المسموح لها بتوزيع إصدار من هذا المنتج.",
    channelsAll: "كل القنوات تستطيع بيع هذا المنتج: لا إصدار يقيّده.",
    colOffering: "الإصدار",
    colProvider: "جهة الاكتتاب",
    colPricing: "طريقة التسعير",
    colCommission: "العمولة",
    colEffective: "يبدأ من",
    colChannel: "القناة",
    colChannelKind: "النوع",
    colDefaultShare: "الحصة الافتراضية",
    unnamed: "بلا اسم",
    "line.motor": "المركبات",
    "line.health": "الصحي",
    "line.travel": "السفر",
    "line.home": "المنازل",
    "line.life": "الحياة",
    "line.sme": "المنشآت الصغيرة",
    "line.card": "البطاقات",
    "line.loan": "التمويل",
    "line.account": "الحسابات",
    "structure.conventional": "تقليدية",
    "structure.takaful": "تكافلية",
    "structure.parametric": "بارامترية",
    "pricingMode.api": "واجهة مباشرة",
    "pricingMode.table": "جدول أسعار",
    "pricingMode.manual": "يدويًا",
    "pricingMode.referral": "بالإحالة",
    "kind.b2c": "مباشر",
    "kind.b2b": "شريك"
  }
};

export const labelsIn = labelsFrom(LABELS);

/** The channel keys a version restricts itself to; empty means unrestricted. */
export function channelKeysOf(offerings: readonly OfferingRow[]): string[] {
  const keys = new Set<string>();
  for (const offering of offerings) {
    if (!Array.isArray(offering.channelKeysJson)) continue;
    for (const key of offering.channelKeysJson) if (typeof key === "string") keys.add(key);
  }
  return [...keys];
}

/* ------------------------------------------------------------------ loader */

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const id = params.id as string;
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);
  const options = { env, request };

  const empty = {
    product: null as Product | null,
    offerings: [] as OfferingRow[],
    channels: [] as ChannelRow[],
    unrestricted: false,
    named: {} as Record<string, string>
  };

  if (!held.has(PERM.read)) return empty;
  const [product, offeringPage] = await Promise.all([
    safe(() => api<Product>(`/v1/core/products/${id}`, options), null),
    held.has(PERM.offerings)
      ? safe(() => api<Page<OfferingRow>>(`/v1/dist/offerings?productId=${id}&limit=50`, options), null)
      : null
  ]);
  if (!product) return empty;

  // Which channels distribute it is not a column anywhere: it is the union of
  // the `channelKeysJson` allow-lists on this product's versions, resolved
  // against the channel register. No list means no restriction.
  const offerings = rowsOf(offeringPage);
  const keys = channelKeysOf(offerings);
  const channels =
    held.has(PERM.channels) && keys.length > 0
      ? await safe(
          () => api<Page<ChannelRow>>(`/v1/dist/channels?key=${encodeURIComponent(keys.join(","))}&limit=50`, options),
          null
        )
      : null;

  const named = await names(
    offerings.map((row) => row.providerId),
    options
  ).catch(() => ({}) as Record<string, string>);

  return {
    ...empty,
    product,
    named,
    offerings,
    channels: rowsOf(channels),
    unrestricted: offerings.length > 0 && keys.length === 0
  };
}

/* --------------------------------------------------------------- component */

export default function ProductDetail() {
  const loaded = useLoaderData<typeof loader>();
  const shell = useShellData();
  const locale = shell?.locale ?? "en";
  const t = translator(locale, shell?.overrides);
  const l = labelsIn(locale, shell?.domainPack);

  if (!loaded.product) {
    return (
      <div className="flex flex-col gap-6">
        <Header title={l("definitionTitle")} intro={l("intro")} />
        <EmptyState title={l("deniedTitle")} body={t("error.forbidden")} />
      </div>
    );
  }

  const product = loaded.product;

  const offeringColumns: Array<Column<OfferingRow>> = [
    {
      key: "code",
      header: l("colOffering"),
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-ui text-12 text-text">{nameOf(row.nameJson, locale, l("unnamed"))}</span>
          <span className="font-mono text-12 text-subtle">{row.code}</span>
        </span>
      )
    },
    {
      key: "providerId",
      header: l("colProvider"),
      render: (row) => (
        <span className="font-ui text-12">{loaded.named[row.providerId] ?? <Ref value={row.providerId} />}</span>
      )
    },
    { key: "status", header: l("colStatus"), render: (row) => <Badge size="sm">{tag(l, "status", row.status)}</Badge> },
    {
      key: "pricingMode",
      header: l("colPricing"),
      render: (row) => <span className="font-ui text-12">{tag(l, "pricingMode", row.pricingMode)}</span>
    },
    {
      key: "baseCommissionPpm",
      header: l("colCommission"),
      numeric: true,
      render: (row) => <span className="font-mono text-12">{percentOf(row.baseCommissionPpm, locale)}</span>
    },
    {
      key: "minPremiumMinor",
      header: l("minPremiumMinor"),
      numeric: true,
      render: (row) =>
        row.minPremiumMinor != null ? (
          <Money amountMinor={row.minPremiumMinor} currency={row.currency} locale={locale} />
        ) : (
          <span>—</span>
        )
    },
    {
      key: "effectiveFrom",
      header: l("colEffective"),
      render: (row) => <DateTime value={row.effectiveFrom} locale={locale} precision="day" />
    }
  ];

  const channelColumns: Array<Column<ChannelRow>> = [
    {
      key: "key",
      header: l("colChannel"),
      render: (row) => (
        <Link to={`/distribution/channels/${row.id}/detail`} className="text-accent hover:underline">
          {nameOf(row.nameJson, locale, row.key)}
        </Link>
      )
    },
    { key: "kind", header: l("colChannelKind"), render: (row) => <span className="font-ui text-12">{tag(l, "kind", row.kind)}</span> },
    { key: "status", header: l("colStatus"), render: (row) => <Badge size="sm">{tag(l, "status", row.status)}</Badge> },
    {
      key: "defaultCommissionPpm",
      header: l("colDefaultShare"),
      numeric: true,
      render: (row) => <span className="font-mono text-12">{percentOf(row.defaultCommissionPpm, locale)}</span>
    }
  ];

  return (
    <div className="flex flex-col gap-6">
      <Header title={nameOf(product.nameJson, locale, product.id)} intro={l("intro")} />

      <Link to="/admin/products" className="font-ui text-12 text-accent underline-offset-2 hover:underline">
        {l("back")}
      </Link>

      <Card
        title={l("definitionTitle")}
        actions={
          <Badge size="sm" dot>
            {tag(l, "status", product.status)}
          </Badge>
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-6 md:grid-cols-3">
          <Stat label={l("line")} value={<span className="font-ui text-13">{tag(l, "line", product.line)}</span>} />
          <Stat label={l("versionCount")} value={<span className="font-mono text-13">{loaded.offerings.length}</span>} />
          <Stat
            label={l("channelCount")}
            value={<span className="font-mono text-13">{loaded.unrestricted ? "—" : loaded.channels.length}</span>}
          />
        </div>
        <Facts>
          <Entry term={l("structure")}>{tag(l, "structure", product.structure)}</Entry>
          <Entry term={l("provider")}>{product.providerId ?? "—"}</Entry>
          <Entry term={l("terms")}>{product.termsRef ?? "—"}</Entry>
        </Facts>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title={l("pricingTitle")} description={l("pricingCaption")}>
          <Payload value={product.pricingInputsJson} />
        </Card>
        <Card title={l("coverTitle")} description={l("coverCaption")}>
          <Payload value={loaded.offerings.map((offering) => ({ [offering.code]: offering.coverageJson ?? {} }))} />
        </Card>
      </div>

      {product.structure === "takaful" ? (
        <Card title={l("takafulTitle")}>
          <Payload value={product.takafulJson} />
        </Card>
      ) : null}

      {product.structure === "parametric" ? (
        <Card title={l("parametricTitle")}>
          <Payload value={product.parametricTriggerJson} />
        </Card>
      ) : null}

      <Card title={l("versionsTitle")} padded={false}>
        <Table
          caption={l("versionsCaption")}
          columns={offeringColumns}
          rows={loaded.offerings}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("none")} />}
        />
      </Card>

      <Card title={l("channelsTitle")} padded={false}>
        <Table
          caption={l("channelsCaption")}
          columns={channelColumns}
          rows={loaded.channels}
          rowKey={(row) => row.id}
          empty={<EmptyState title={loaded.unrestricted ? l("channelsAll") : l("none")} />}
        />
      </Card>

      <Card title={l("mappingTitle")}>
        <Payload value={product.standardMappingJson} />
      </Card>
    </div>
  );
}
