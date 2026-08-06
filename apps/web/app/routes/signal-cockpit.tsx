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
  AGENT_MARK,
  Badge,
  Button,
  Card,
  DateTime,
  EmptyState,
  EvidenceLink,
  KPIWall,
  Money,
  ProgressBar,
  Sparkline,
  Stat,
  Table,
  type Column
} from "@lyra/ui";
import { ApiError, api, fetchMe } from "../api.server";
import { arrowFor } from "../i18n";
import { cloudflare } from "../context";
import { Gate } from "./staff";
import { channelColumns } from "./signal-studio";
import { useShellData } from "./workspace";
import {
  PERM,
  WINDOWS,
  budgetOf,
  cacMinor,
  dailySpend,
  explain,
  labelsIn,
  mintKey,
  plannedMinor,
  rollByChannel,
  safe,
  totalSpendMinor,
  windowDays,
  type CampaignRow,
  type MoveRow,
  type Page,
  type Problemish,
  type SpendRow,
  type TouchRow
} from "./signal.shared";

// The marketing operator's landing view. The campaigns tab answers "what exists"
// and the spend tab answers "what it cost", but nobody starts their day with a
// list: they want the window's money against its plan, the channels that turned
// it into customers, and — because the budget autopilot moves money while nobody
// is watching — what the agents changed and why (docs/15 §4 background work is
// reported, never hidden).

const empty = <T,>(): Page<T> => ({ data: [] });

const RUNNING_STATES = ["live", "paused"];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const days = windowDays(new URL(request.url).searchParams.get("days"));
  const from = Date.now() - days * 86_400_000;
  const window = `sort=ts&from=${from}&limit=200`;

  const [me, campaigns, spend, touches, moves] = await Promise.all([
    safe(() => fetchMe(env, request), null),
    safe(() => api<Page<CampaignRow>>("/v1/signal/campaigns?limit=200", { env, request }), empty<CampaignRow>()),
    safe(() => api<Page<SpendRow>>(`/v1/signal/spend?${window}`, { env, request }), empty<SpendRow>()),
    safe(
      () => api<Page<TouchRow>>(`/v1/signal/attribution-events?${window}`, { env, request }),
      empty<TouchRow>()
    ),
    safe(() => api<Page<MoveRow>>(`/v1/signal/budget-moves?${window}`, { env, request }), empty<MoveRow>())
  ]);

  const running = campaigns.data.filter((campaign) => RUNNING_STATES.includes(campaign.state));
  return {
    days,
    // The kill switch lives on the tenant policy, and /v1/me is the only read
    // that returns it (apps/api/src/routes/signal.ts setAutopilotPaused).
    autopilotPaused: Boolean(me?.policy?.signalAutopilotPaused),
    spend: spend.data,
    touches: touches.data,
    moves: moves.data,
    running,
    plannedMinor: running.reduce((sum, campaign) => sum + plannedMinor(budgetOf(campaign), days), 0),
    currency: budgetOf(running[0] ?? campaigns.data[0] ?? ({} as CampaignRow)).currency ?? "ZAR",
    key: mintKey("signal-cockpit")
  };
}

export interface ActionResult {
  problem: Problemish | null;
  done: string | null;
  /** How many moves the manual autopilot pass made, when that was the intent. */
  adjusted: number | null;
}

const refuse = (code: string, status = 400): ActionResult => ({
  problem: { title: code, status, code },
  done: null,
  adjusted: null
});

export async function action({ request, context }: ActionFunctionArgs): Promise<ActionResult> {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const headers = { "idempotency-key": String(form.get("key") ?? "") || mintKey("signal-cockpit") };

  try {
    switch (intent) {
      // Pausing and resuming the autopilot is not itself a spend, but it changes
      // who may spend, so both are audited on the API side.
      case "pause":
      case "resume": {
        await api(`/v1/signal/autopilot/${intent}`, { env, request, method: "POST", headers });
        return { problem: null, done: intent, adjusted: null };
      }
      case "run": {
        const result = await api<{ adjusted: unknown }>("/v1/signal/autopilot/run", {
          env,
          request,
          method: "POST",
          headers
        });
        const moves = Array.isArray(result.adjusted) ? result.adjusted.length : Number(result.adjusted) || 0;
        return { problem: null, done: intent, adjusted: moves };
      }
      default:
        return refuse("bad_intent");
    }
  } catch (error) {
    if (error instanceof ApiError) return { problem: error.problem, done: null, adjusted: null };
    throw error;
  }
}

export default function GrowthCockpit() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const navigation = useNavigation();
  const l = labelsIn(shell?.locale ?? "en", shell?.domainPack);
  const locale = shell?.locale ?? "en";
  const may = new Set(shell?.permissions ?? []);
  const busy = navigation.state !== "idle";

  const spent = totalSpendMinor(loaded.spend);
  const rolls = rollByChannel(loaded.spend, loaded.touches);
  const binds = rolls.reduce((sum, roll) => sum + roll.binds, 0);
  const cac = cacMinor(spent, binds);
  const trend = dailySpend(loaded.spend);
  const planPct = loaded.plannedMinor > 0 ? Math.round((spent / loaded.plannedMinor) * 100) : 0;
  const currency = loaded.currency;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-24 font-bold text-text">{l("cockpit.title")}</h1>
          <p className="max-w-prose font-ui text-13 text-muted">{l("cockpit.lede")}</p>
        </div>
        <nav aria-label={l("growth.window")} className="flex items-center gap-2">
          {WINDOWS.map((days) => (
            <Link
              key={days}
              to={`/signal/cockpit?days=${days}`}
              className="font-ui text-12 text-accent underline-offset-2 hover:underline"
              aria-current={loaded.days === days ? "page" : undefined}
            >
              <Badge tone={loaded.days === days ? "accent" : "neutral"}>{l("days", { n: String(days) })}</Badge>
            </Link>
          ))}
        </nav>
      </header>

      {result?.problem ? <Gate problem={explain(result.problem, l)} l={l} /> : null}
      {result?.adjusted !== null && result?.adjusted !== undefined ? (
        <p className="font-ui text-13 text-success">
          {AGENT_MARK} {l("cockpit.adjusted", { n: String(result.adjusted) })}
        </p>
      ) : null}

      <KPIWall>
        <Stat
          label={l("cockpit.spendToDate")}
          value={<Money amountMinor={spent} currency={currency} locale={locale} />}
          hint={l("days", { n: String(loaded.days) })}
        />
        <Stat
          label={l("plan")}
          value={<Money amountMinor={loaded.plannedMinor} currency={currency} locale={locale} />}
        />
        <Stat label={l("binds")} value={binds} />
        <Stat
          label={l("cac")}
          value={cac === null ? l("none") : <Money amountMinor={cac} currency={currency} locale={locale} />}
        />
      </KPIWall>

      <div className="flex flex-col gap-1">
        <span className="font-ui text-12 uppercase tracking-wider text-subtle">{l("cockpit.againstPlan")}</span>
        <ProgressBar
          value={Math.min(planPct, 100)}
          tone={planPct > 100 ? "danger" : planPct > 80 ? "warning" : "accent"}
          label={l("cockpit.againstPlan")}
        />
      </div>

      <Card title={l("cockpit.autopilot")}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={loaded.autopilotPaused ? "warning" : "success"} dot>
            {loaded.autopilotPaused ? l("cockpit.paused") : l("cockpit.running")}
          </Badge>
          <Form method="post" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="key" value={loaded.key} />
            {may.has(PERM.autopilotPause) ? (
              <Button
                type="submit"
                name="intent"
                value={loaded.autopilotPaused ? "resume" : "pause"}
                variant={loaded.autopilotPaused ? "primary" : "secondary"}
                disabled={busy}
              >
                {loaded.autopilotPaused ? l("cockpit.resume") : l("cockpit.pause")}
              </Button>
            ) : null}
            {may.has(PERM.autopilotRun) ? (
              <Button type="submit" name="intent" value="run" variant="ghost" disabled={busy}>
                {l("cockpit.runNow")}
              </Button>
            ) : null}
          </Form>
          <EvidenceLink source="/docs/modules/signal.md" sourceLabel={l("why")}>
            {l("cockpit.autopilotWhy")}
          </EvidenceLink>
        </div>
      </Card>

      {trend.length > 1 ? (
        <Card title={l("cockpit.trend")}>
          <Sparkline
            values={trend.map((point) => point.amountMinor)}
            label={l("cockpit.trend")}
            tone="accent"
          />
        </Card>
      ) : null}

      <Card title={l("cockpit.pipeline")}>
        {rolls.length === 0 ? (
          <EmptyState title={l("growth.noSpend")} />
        ) : (
          <Table
            caption={l("cockpit.pipelineCaption")}
            captionHidden
            rowKey={(roll) => roll.channel}
            rows={rolls}
            columns={channelColumns(l, locale, currency)}
          />
        )}
      </Card>

      <Card
        title={l("cockpit.liveCampaigns")}
        actions={
          <Link to="/signal/studio" className="font-ui text-12 text-accent underline-offset-2 hover:underline">
            {l("cockpit.startOne")}
          </Link>
        }
      >
        {loaded.running.length === 0 ? (
          <EmptyState title={l("cockpit.noCampaigns")} />
        ) : (
          <Table
            caption={l("cockpit.liveCaption")}
            captionHidden
            rowKey={(campaign) => campaign.id}
            rows={loaded.running}
            columns={campaignColumns(l, locale)}
          />
        )}
      </Card>

      <Card title={l("cockpit.changesToday")} description={l("cockpit.changesCaption")}>
        {loaded.moves.length === 0 ? (
          <EmptyState title={l("cockpit.noChanges")} />
        ) : (
          <Table
            caption={l("cockpit.changesCaption")}
            captionHidden
            rowKey={(move) => move.id}
            rows={loaded.moves}
            columns={moveColumns(l, locale)}
          />
        )}
      </Card>

      <nav aria-label={l("cockpit.title")} className="flex flex-wrap items-center gap-4">
        <Link to="/signal/budget" className="font-ui text-13 text-accent underline-offset-2 hover:underline">
          {l("cockpit.openBudget")}
        </Link>
        <Link to="/signal/analytics" className="font-ui text-13 text-accent underline-offset-2 hover:underline">
          {l("cockpit.openAnalytics")}
        </Link>
      </nav>
    </div>
  );
}

function campaignColumns(l: (key: string) => string, locale: string): Array<Column<CampaignRow>> {
  return [
    {
      key: "name",
      header: l("campaign"),
      render: (campaign) => (
        <Link
          to={`/signal/studio?campaignId=${encodeURIComponent(campaign.id)}`}
          className="text-accent underline-offset-2 hover:underline"
        >
          {campaign.name}
        </Link>
      )
    },
    { key: "state", header: l("state"), render: (campaign) => <Badge tone="neutral">{l(campaign.state)}</Badge> },
    { key: "objective", header: l("studio.objective"), render: (campaign) => l(campaign.objective) },
    { key: "autonomy", header: l("autonomy"), render: (campaign) => l(`autonomy.${campaign.autonomyLevel}`) },
    {
      key: "daily",
      header: l("budget.daily"),
      numeric: true,
      render: (campaign) => {
        const budget = budgetOf(campaign);
        return (
          <Money
            amountMinor={budget.dailyMinor ?? 0}
            currency={budget.currency ?? "ZAR"}
            locale={locale}
          />
        );
      }
    }
  ];
}

/** The agents' own audit trail, in the operator's language. Shared with the
 *  budget screen, which adds the undo column. */
export function moveColumns(l: (key: string) => string, locale: string): Array<Column<MoveRow>> {
  return [
    { key: "when", header: l("when"), render: (move) => <DateTime value={move.ts} locale={locale} /> },
    {
      key: "from",
      header: l("budget.moves"),
      render: (move) => `${move.fromRef} ${arrowFor(locale)} ${move.toRef}`
    },
    {
      key: "amount",
      header: l("amount"),
      numeric: true,
      render: (move) => <Money amountMinor={move.amountMinor} currency={move.currency} locale={locale} />
    },
    { key: "reason", header: l("reason"), render: (move) => move.reason },
    {
      key: "by",
      header: l("cockpit.movedBy"),
      render: (move) => (
        <Badge tone={move.approvedBy ? "info" : "accent"}>
          {move.approvedBy ? l("budget.needsApproval") : l("budget.autoApproved")}
        </Badge>
      )
    }
  ];
}
