import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import {
  AGENT_MARK,
  AgentBadge,
  Badge,
  Button,
  Card,
  DateTime,
  EmptyState,
  EvidenceLink,
  Field,
  GuardrailNotice,
  Input,
  Money,
  Select,
  Stat,
  Table,
  Textarea,
  type BadgeTone,
  type Column
} from "@lyra/ui";
import { ApiError, api } from "../api.server";
import { cloudflare } from "../context";
import { Gate } from "./staff";
import { useShellData } from "./workspace";
import {
  PERM,
  budgetOf,
  canLaunch,
  channelsOf,
  explain,
  labelsIn,
  mintKey,
  nextStates,
  rollByChannel,
  safe,
  totalSpendMinor,
  type AudienceRow,
  type CampaignRow,
  type ChannelRoll,
  type CreativeRow,
  type Page,
  type Problemish,
  type SpendRow,
  type TouchRow
} from "./signal.shared";

// The campaign studio: goal → drafted content → review → launch → watch it run,
// on one screen. The generic campaigns tab can create a row, but it cannot write
// the words, and the creatives tab can hold the words but not connect them to a
// launch — so the thing a marketer actually does had no home.
//
// Every model call here is `POST /v1/signal/creatives/generate`
// (apps/api/src/routes/signal.ts), which runs through packages/model-gateway and
// returns the `ai_audit_log` id of each variant. Nothing on this screen sends
// anything: generation writes drafts, clearing a draft is a compliance verdict,
// and going live is a state change the API routes through the
// `signal.campaign_launch` approval.
//
// Progress lives in the URL (`?campaignId=…`), not in component state: a
// generate is a POST that redirects, so a refresh re-reads the drafts instead of
// asking the model for a second set.

/* ------------------------------------------------------------------ constants */

export const OBJECTIVES = ["acq", "renewal", "xsell"] as const;
/** `GenerateBody.kind`, apps/api/src/routes/signal.ts. No other value is accepted. */
export const KINDS = ["ad", "lp", "email", "social", "video_script"] as const;
export const CONTENT_LOCALES = ["en", "ar"] as const;
/** The generate handler caps `count` at 100; a review screen caps itself lower. */
export const MAX_VARIANTS = 8;

const DRAFT_STATES = ["draft", "review", "scheduled"];
const LIVE_STATES = ["live", "paused"];

/* -------------------------------------------------------------------- loader */

const empty = <T,>(): Page<T> => ({ data: [] });

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const url = new URL(request.url);
  const campaignId = url.searchParams.get("campaignId") ?? "";
  const generated = Number(url.searchParams.get("generated") ?? "");

  const [recent, audiences] = await Promise.all([
    safe(
      () =>
        api<Page<CampaignRow>>("/v1/signal/campaigns?limit=25&sort=createdAt&order=desc", {
          env,
          request
        }),
      empty<CampaignRow>()
    ),
    safe(() => api<Page<AudienceRow>>("/v1/signal/audiences?limit=50", { env, request }), empty<AudienceRow>())
  ]);

  const campaign = campaignId
    ? await safe(() => api<CampaignRow>(`/v1/signal/campaigns/${campaignId}`, { env, request }), null)
    : null;

  const scope = campaign ? `?campaignId=${encodeURIComponent(campaign.id)}&limit=100` : "";
  const [creatives, spend, touches] = await Promise.all([
    campaign
      ? safe(() => api<Page<CreativeRow>>(`/v1/signal/creatives${scope}`, { env, request }), empty<CreativeRow>())
      : Promise.resolve(empty<CreativeRow>()),
    campaign
      ? safe(() => api<Page<SpendRow>>(`/v1/signal/spend${scope}`, { env, request }), empty<SpendRow>())
      : Promise.resolve(empty<SpendRow>()),
    campaign
      ? safe(
          () => api<Page<TouchRow>>(`/v1/signal/attribution-events${scope}`, { env, request }),
          empty<TouchRow>()
        )
      : Promise.resolve(empty<TouchRow>())
  ]);

  return {
    campaign,
    generated: Number.isFinite(generated) && generated > 0 ? generated : 0,
    audiences: audiences.data,
    drafts: recent.data.filter((row) => DRAFT_STATES.includes(row.state)),
    creatives: creatives.data,
    spend: spend.data,
    touches: touches.data,
    // One key per load: a double-submitted launch is one launch (docs/19 §4).
    key: mintKey("signal-studio")
  };
}

/* -------------------------------------------------------------------- action */

export interface ActionResult {
  problem: Problemish | null;
  /** The intent that succeeded, so the screen can say which one. */
  done: string | null;
}

const refuse = (code: string, status = 400): ActionResult => ({
  problem: { title: code, status, code },
  done: null
});

const text = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();

const positive = (form: FormData, name: string): number | null => {
  const raw = Number(form.get(name) ?? "");
  return Number.isFinite(raw) && Number.isInteger(raw) && raw > 0 ? raw : null;
};

export async function action({ request, context }: ActionFunctionArgs): Promise<ActionResult> {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const intent = text(form, "intent");
  const key = text(form, "key") || mintKey("signal-studio");
  const headers = { "idempotency-key": key };

  try {
    switch (intent) {
      case "create-campaign": {
        const name = text(form, "name");
        if (!name) return refuse("name_required");
        const objective = text(form, "objective");
        if (!OBJECTIVES.some((allowed) => allowed === objective)) return refuse("objective_required");
        const owner = text(form, "ownerRef");
        if (!owner) return refuse("owner_required");
        const channels = text(form, "channels")
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
        if (channels.length === 0) return refuse("channels_required");
        const dailyMinor = positive(form, "dailyMinor");
        if (dailyMinor === null) return refuse("budget_required");
        const bound = positive(form, "boundMinor");

        const created = await api<CampaignRow>("/v1/signal/campaigns", {
          env,
          request,
          method: "POST",
          headers,
          body: {
            name,
            objective,
            ownerRef: owner,
            ...(text(form, "audienceId") ? { audienceId: text(form, "audienceId") } : {}),
            channelsJson: channels,
            budgetJson: {
              dailyMinor,
              currency: text(form, "currency") || "ZAR",
              // The autopilot's per-decision ceiling. Named here rather than
              // left to the engine default so the bound is the operator's.
              ...(bound === null ? {} : { autopilotBoundMinor: bound })
            }
          }
        });
        // A redirect, not a result: the next read is a GET, so a refresh cannot
        // create a second campaign.
        throw redirect(`/signal/studio?campaignId=${encodeURIComponent(created.id)}`);
      }

      case "generate": {
        const campaignId = text(form, "campaignId");
        if (!campaignId) return refuse("campaign_required");
        const brief = text(form, "brief");
        if (brief.length < 10) return refuse("brief_required");
        const kind = text(form, "kind");
        if (!KINDS.some((allowed) => allowed === kind)) return refuse("kind_required");
        const count = positive(form, "count") ?? 3;
        const locales = form
          .getAll("locales")
          .map((entry) => String(entry))
          .filter((entry) => CONTENT_LOCALES.some((allowed) => allowed === entry));

        const result = await api<{ variants: unknown[] }>("/v1/signal/creatives/generate", {
          env,
          request,
          method: "POST",
          headers,
          body: {
            campaignId,
            kind,
            brief,
            count: Math.min(count, MAX_VARIANTS),
            ...(locales.length > 0 ? { locales } : {})
          }
        });
        throw redirect(
          `/signal/studio?campaignId=${encodeURIComponent(campaignId)}&generated=${result.variants.length}`
        );
      }

      case "edit-variant": {
        const id = text(form, "creativeId");
        if (!id) return refuse("creative_required");
        const contentRef = text(form, "contentRef");
        if (!contentRef) return refuse("content_required");
        await api(`/v1/signal/creatives/${id}`, {
          env,
          request,
          method: "PATCH",
          headers,
          body: { contentRef }
        });
        return { problem: null, done: intent };
      }

      // Clearing and discarding are the same write with opposite verdicts, and
      // both carry `signal.creative_publish` on the API side.
      case "clear-variant":
      case "discard-variant": {
        const id = text(form, "creativeId");
        if (!id) return refuse("creative_required");
        await api(`/v1/signal/creatives/${id}`, {
          env,
          request,
          method: "PATCH",
          headers,
          body: { complianceStatus: intent === "clear-variant" ? "passed" : "blocked" }
        });
        return { problem: null, done: intent };
      }

      // Consequential (CLAUDE.md §4): the API gates this on
      // `signal.campaign_launch`, and a 403 `approval_required` is the honest
      // answer, not a failure to hide.
      case "launch":
      case "pause": {
        const id = text(form, "campaignId");
        if (!id) return refuse("campaign_required");
        const state = intent === "launch" ? "live" : "paused";
        await api(`/v1/signal/campaigns/${id}`, {
          env,
          request,
          method: "PATCH",
          headers,
          body: { state }
        });
        return { problem: null, done: intent };
      }

      default:
        return refuse("bad_intent");
    }
  } catch (error) {
    if (error instanceof ApiError) return { problem: error.problem, done: null };
    throw error;
  }
}

/* ---------------------------------------------------------------- rendering */

function toneOf(status: string): BadgeTone {
  if (status === "passed") return "success";
  if (status === "blocked") return "danger";
  if (status === "flagged") return "warning";
  return "neutral";
}

export default function CampaignStudio() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const navigation = useNavigation();
  const l = labelsIn(shell?.locale ?? "en", shell?.domainPack);
  const may = new Set(shell?.permissions ?? []);
  const locale = shell?.locale ?? "en";
  const busy = navigation.state !== "idle";

  const campaign = loaded.campaign;
  const budget = campaign ? budgetOf(campaign) : {};
  const currency = budget.currency ?? "ZAR";
  const mine = loaded.creatives;
  const cleared = mine.filter((creative) => creative.complianceStatus === "passed");
  const live = campaign ? LIVE_STATES.includes(campaign.state) : false;
  const rolls = rollByChannel(loaded.spend, loaded.touches);

  const step = !campaign ? 1 : mine.length === 0 ? 2 : live ? 5 : cleared.length === 0 ? 3 : 4;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-24 leading-[1.2] text-text">{l("studio.title")}</h1>
        <p className="max-w-prose font-ui text-13 text-muted">{l("studio.lede")}</p>
      </header>

      <ol className="flex flex-wrap items-center gap-2 font-ui text-12">
        {[
          ["studio.step1", 1],
          ["studio.step2", 2],
          ["studio.step3", 3],
          ["studio.step4", 4],
          ["studio.step5", 5]
        ].map(([labelKey, at]) => (
          <li key={String(labelKey)}>
            <Badge tone={step === at ? "accent" : step > Number(at) ? "success" : "neutral"}>
              {l(String(labelKey))}
            </Badge>
          </li>
        ))}
      </ol>

      {result?.problem ? <Gate problem={explain(result.problem, l)} l={l} /> : null}
      {loaded.generated > 0 ? (
        <p className="font-ui text-13 text-success">
          {AGENT_MARK} {l("studio.generated", { n: String(loaded.generated) })}
        </p>
      ) : null}
      {result?.done === "launch" ? (
        <p className="font-ui text-13 text-success">{l("studio.launched")}</p>
      ) : null}

      {campaign ? null : (
        <Card title={l("studio.step1")} description={l("studio.created")}>
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="create-campaign" />
            <input type="hidden" name="key" value={loaded.key} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={l("studio.name")} required>
                <Input name="name" required maxLength={120} />
              </Field>
              <Field label={l("studio.objective")} required>
                <Select
                  name="objective"
                  defaultValue="acq"
                  options={OBJECTIVES.map((value) => ({ value, label: l(value) }))}
                />
              </Field>
              <Field label={l("audience")} hint={l("studio.audienceHint")}>
                <Select
                  name="audienceId"
                  options={loaded.audiences.map((audience) => ({
                    value: audience.id,
                    label: audience.name
                  }))}
                />
              </Field>
              <Field label={l("studio.channels")} required>
                <Input name="channels" required defaultValue="google,meta" />
              </Field>
              <Field label={l("studio.daily")} required>
                <Input name="dailyMinor" type="number" min={1} step={1} required defaultValue={50000} />
              </Field>
              <Field label={l("bound")} hint={l("studio.boundHint")}>
                <Input name="boundMinor" type="number" min={1} step={1} defaultValue={10000} />
              </Field>
              <Field label={l("studio.owner")} required>
                <Input name="ownerRef" required defaultValue={shell?.actorName ?? ""} />
              </Field>
            </div>
            <input type="hidden" name="currency" value={currency} />
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" disabled={busy || !may.has(PERM.campaignsCreate)}>
                {l("studio.create")}
              </Button>
              {may.has(PERM.campaignsCreate) ? null : (
                <span className="font-ui text-12 text-subtle">{l("noPermission")}</span>
              )}
            </div>
          </Form>

          {loaded.drafts.length > 0 ? (
            <div className="mt-6 border-t border-border pt-4">
              <h2 className="mb-2 font-ui text-12 uppercase tracking-[0.14em] text-subtle">
                {l("studio.pickCampaign")}
              </h2>
              <ul className="flex flex-col divide-y divide-border border-y border-border">
                {loaded.drafts.map((draft) => (
                  <li key={draft.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="font-ui text-13 text-text">{draft.name}</span>
                    <span className="flex items-center gap-3">
                      <Badge tone="neutral">{l(draft.state)}</Badge>
                      <Link
                        to={`/signal/studio?campaignId=${encodeURIComponent(draft.id)}`}
                        aria-label={`${l("studio.open")}: ${draft.name}`}
                        className="font-ui text-12 text-accent underline-offset-2 hover:underline"
                      >
                        {l("studio.open")}
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      )}

      {campaign ? (
        <>
          <Card
            title={campaign.name}
            description={`${l(campaign.objective)} · ${l(campaign.state)}`}
            actions={
              <Link
                to="/signal/studio"
                className="font-ui text-12 text-accent underline-offset-2 hover:underline"
              >
                {l("studio.newCampaign")}
              </Link>
            }
          >
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label={l("budget.daily")}
                value={<Money amountMinor={budget.dailyMinor ?? 0} currency={currency} locale={locale} />}
              />
              <Stat
                label={l("bound")}
                value={
                  <Money amountMinor={budget.autopilotBoundMinor ?? 0} currency={currency} locale={locale} />
                }
              />
              <Stat label={l("autonomy")} value={l(`autonomy.${campaign.autonomyLevel}`)} />
              <Stat label={l("studio.channels")} value={channelsOf(campaign).join(" · ") || "—"} />
            </dl>
          </Card>

          {may.has(PERM.creativesGenerate) ? (
            <Card title={l("studio.brief")} description={l("studio.briefHint")}>
              <Form method="post" className="flex flex-col gap-4">
                <input type="hidden" name="intent" value="generate" />
                <input type="hidden" name="key" value={loaded.key} />
                <input type="hidden" name="campaignId" value={campaign.id} />
                <Field label={l("studio.brief")} labelHidden required>
                  <Textarea name="brief" rows={4} required minLength={10} maxLength={4000} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={l("studio.kind")} required>
                    <Select
                      name="kind"
                      defaultValue="ad"
                      options={KINDS.map((value) => ({ value, label: l(value) }))}
                    />
                  </Field>
                  <Field label={l("studio.count")}>
                    <Input name="count" type="number" min={1} max={MAX_VARIANTS} defaultValue={3} />
                  </Field>
                  <Field label={l("studio.locales")}>
                    <span className="flex items-center gap-3 pt-2">
                      {CONTENT_LOCALES.map((value) => (
                        <label key={value} className="flex items-center gap-2 font-ui text-13 text-muted">
                          <input
                            type="checkbox"
                            name="locales"
                            value={value}
                            defaultChecked={value === "en"}
                            className="size-4 accent-accent"
                          />
                          {l(`locale.${value}`)}
                        </label>
                      ))}
                    </span>
                  </Field>
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit" variant="primary" disabled={busy}>
                    {busy ? l("studio.generating") : `${AGENT_MARK} ${l("studio.generate")}`}
                  </Button>
                  <EvidenceLink source="/docs/15-ai-ux-patterns.md" sourceLabel={l("why")}>
                    {l("studio.whyDraft")}
                  </EvidenceLink>
                </div>
              </Form>
            </Card>
          ) : null}

          <Card title={l("studio.variants")} description={l("studio.whyDraft")}>
            {mine.length === 0 ? (
              <EmptyState title={l("studio.noVariants")} />
            ) : (
              <ul className="flex flex-col divide-y divide-border border-y border-border">
                {mine.map((creative) => (
                  <li key={creative.id} className="flex flex-col gap-3 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={toneOf(creative.complianceStatus)} dot>
                        {l(creative.complianceStatus)}
                      </Badge>
                      <Badge tone="neutral">{l(creative.kind)}</Badge>
                      <Badge tone="neutral">{l(`locale.${creative.locale}`)}</Badge>
                      {creative.generatedBy === "ai" ? (
                        <AgentBadge why={l("studio.whyDraft")} />
                      ) : null}
                      <span className="ms-auto font-mono text-11 text-subtle">
                        <DateTime value={creative.createdAt} locale={locale} />
                      </span>
                    </div>

                    {creative.complianceStatus === "blocked" ? (
                      <GuardrailNotice
                        title={l("blocked")}
                        reason={l("studio.blockedNote")}
                        tone="warning"
                      />
                    ) : null}

                    <Form method="post" className="flex flex-col gap-2">
                      <input type="hidden" name="key" value={loaded.key} />
                      <input type="hidden" name="creativeId" value={creative.id} />
                      <Field label={l("studio.editVariant")} labelHidden>
                        <Textarea
                          name="contentRef"
                          rows={3}
                          defaultValue={creative.contentRef}
                          readOnly={!may.has(PERM.creativesApprove)}
                          aria-label={l("studio.editVariant")}
                        />
                      </Field>
                      {may.has(PERM.creativesApprove) ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="submit" name="intent" value="edit-variant" disabled={busy}>
                            {l("save")}
                          </Button>
                          <Button
                            type="submit"
                            name="intent"
                            value="clear-variant"
                            variant="primary"
                            disabled={busy || creative.complianceStatus === "passed"}
                          >
                            {creative.complianceStatus === "passed" ? l("studio.approved") : l("studio.approve")}
                          </Button>
                          <Button type="submit" name="intent" value="discard-variant" variant="ghost" disabled={busy}>
                            {l("studio.discard")}
                          </Button>
                        </div>
                      ) : null}
                    </Form>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={l("studio.step4")} description={l("studio.launchHint")}>
            {live ? (
              <Form method="post" className="flex items-center gap-3">
                <input type="hidden" name="intent" value="pause" />
                <input type="hidden" name="key" value={loaded.key} />
                <input type="hidden" name="campaignId" value={campaign.id} />
                <Badge tone="success" dot>
                  {l(campaign.state)}
                </Badge>
                <Button type="submit" disabled={busy || !nextStates(campaign.state).includes("paused")}>
                  {l("studio.pause")}
                </Button>
              </Form>
            ) : (
              <Form method="post" className="flex flex-col gap-2">
                <input type="hidden" name="intent" value="launch" />
                <input type="hidden" name="key" value={loaded.key} />
                <input type="hidden" name="campaignId" value={campaign.id} />
                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={busy || !may.has(PERM.campaignsUpdate) || !canLaunch(campaign, mine)}
                  >
                    {l("studio.launch")}
                  </Button>
                  {canLaunch(campaign, mine) ? null : (
                    <span className="font-ui text-12 text-warning">{l("studio.launchBlocked")}</span>
                  )}
                </div>
              </Form>
            )}
          </Card>

          {loaded.spend.length > 0 ? (
            <Card title={l("studio.performance")}>
              <dl className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Stat
                  label={l("spend")}
                  value={
                    <Money amountMinor={totalSpendMinor(loaded.spend)} currency={currency} locale={locale} />
                  }
                />
                <Stat
                  label={l("binds")}
                  value={loaded.touches.filter((touch) => touch.touchType === "bind").length}
                />
                <Stat label={l("clicks")} value={rolls.reduce((sum, roll) => sum + roll.clicks, 0)} />
              </dl>
              <Table<ChannelRoll>
                caption={l("studio.performanceCaption")}
                captionHidden
                rowKey={(roll) => roll.channel}
                rows={rolls}
                columns={channelColumns(l, locale, currency)}
              />
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Shared with the cockpit's pipeline table — the same six numbers per channel. */
export function channelColumns(
  l: (key: string) => string,
  locale: string,
  currency: string
): Array<Column<ChannelRoll>> {
  return [
    { key: "channel", header: l("channel"), render: (roll) => roll.channel },
    {
      key: "spend",
      header: l("spend"),
      numeric: true,
      render: (roll) => <Money amountMinor={roll.spendMinor} currency={currency} locale={locale} />
    },
    { key: "impressions", header: l("impressions"), numeric: true, render: (roll) => roll.impressions },
    { key: "clicks", header: l("clicks"), numeric: true, render: (roll) => roll.clicks },
    { key: "conversions", header: l("conversions"), numeric: true, render: (roll) => roll.conversions },
    { key: "binds", header: l("binds"), numeric: true, render: (roll) => roll.binds }
  ];
}
