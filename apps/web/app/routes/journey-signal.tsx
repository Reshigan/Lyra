import * as React from "react";
import { Badge, Button, Card, Hero, hueVar, renderSection, type Section } from "@lyra/ui";
import { Form, useActionData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { ApiError, api, type Problem } from "../api.server";
import { cloudflare } from "../context";
import { JourneyNav } from "../components/journey-nav";

interface Attribute {
  axis: string;
  value: string;
}

interface DemographicReason extends Attribute {
  reason: string;
}

interface TargetingProposal {
  name: string;
  summary: string;
  demographics: Attribute[];
  reasons: DemographicReason[];
}

interface SuggestedAudience {
  audienceId: string;
  proposal: TargetingProposal;
  source: "ai" | "fallback";
}

interface ComplianceFinding {
  code: string;
  message: string;
}

interface GeneratedVariant {
  id: string;
  locale: string;
  text: string;
  complianceStatus: "passed" | "flagged";
  complianceFindings: ComplianceFinding[];
}

interface GenerateCreativesResult {
  variants: GeneratedVariant[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return {
    subject: url.searchParams.get("subject") ?? "",
    whitespaceId: url.searchParams.get("whitespaceId") ?? ""
  };
}

export interface ActionResult {
  problem: Problem | null;
  audience: SuggestedAudience | null;
  creatives: GenerateCreativesResult | null;
}

export async function action({ request, context }: ActionFunctionArgs): Promise<ActionResult> {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "suggest_audience") {
      const subject = String(form.get("subject") ?? "").trim();
      if (subject === "") {
        return { problem: { title: "subject_required", status: 400 }, audience: null, creatives: null };
      }
      const audience = await api<SuggestedAudience>("/v1/signal/audiences/suggest", {
        env,
        request,
        method: "POST",
        body: { subject }
      });
      return { problem: null, audience, creatives: null };
    }

    if (intent === "generate_creatives") {
      const brief = String(form.get("brief") ?? "").trim();
      if (brief === "") {
        return { problem: { title: "brief_required", status: 400 }, audience: null, creatives: null };
      }
      const creatives = await api<GenerateCreativesResult>("/v1/signal/creatives/generate", {
        env,
        request,
        method: "POST",
        body: { kind: "ad", brief, count: 3, locales: ["en", "ar"] }
      });
      return { problem: null, audience: null, creatives };
    }

    return { problem: { title: "bad_intent", status: 400 }, audience: null, creatives: null };
  } catch (error) {
    if (error instanceof ApiError) return { problem: error.problem, audience: null, creatives: null };
    throw error;
  }
}

function groupByComplianceStatus(variants: GeneratedVariant[]): Array<{ status: string; count: number }> {
  const counts = new Map<string, number>();
  for (const v of variants) counts.set(v.complianceStatus, (counts.get(v.complianceStatus) ?? 0) + 1);
  return [...counts.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
}

export default function JourneySignal({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { subject, whitespaceId } = loaderData;
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const [audience, setAudience] = React.useState<SuggestedAudience | null>(null);
  const [creatives, setCreatives] = React.useState<GenerateCreativesResult | null>(null);

  React.useEffect(() => {
    if (result?.audience) setAudience(result.audience);
    if (result?.creatives) setCreatives(result.creatives);
  }, [result]);

  const complianceGroups = creatives ? groupByComplianceStatus(creatives.variants) : [];
  const maxComplianceCount = Math.max(1, ...complianceGroups.map((g) => g.count));

  const complianceBars: Section = {
    kind: "bars",
    title: "Creatives by compliance status",
    items: complianceGroups.map((g) => ({
      label: g.status === "passed" ? "Passed compliance" : "Flagged compliance",
      value: `${g.count} of ${creatives?.variants.length ?? 0}`,
      w: `${Math.max(4, Math.round((g.count / maxComplianceCount) * 100))}%`,
      hue: g.status === "passed" ? "var(--success)" : "var(--warning)",
      note:
        g.status === "flagged"
          ? `${Math.round((g.count / (creatives?.variants.length || 1)) * 100)}% need review before send`
          : `${Math.round((g.count / (creatives?.variants.length || 1)) * 100)}% ready to send`
    }))
  };

  const heroChips = [
    ...(audience
      ? [
          {
            label: "Audience",
            value: audience.proposal.name,
            detail: audience.proposal.summary,
            hue: hueVar("signal")
          }
        ]
      : []),
    ...(creatives
      ? [
          { label: "Creatives", value: String(creatives.variants.length), hue: hueVar("signal") },
          ...complianceGroups.map((g) => ({
            label: g.status === "passed" ? "Passed compliance" : "Flagged compliance",
            value: String(g.count),
            hue: hueVar("signal"),
            detail: `${Math.round((g.count / creatives.variants.length) * 100)}% of generated creatives`
          }))
        ]
      : [])
  ];

  return (
    <div className="flex flex-col gap-6 pb-12">
      <JourneyNav current="signal" />
      <Hero
        eyebrow="SIGNAL"
        title="Campaign, carried from SCOUT"
        sub={
          subject
            ? `Drafting for: ${subject}.${creatives ? ` ${creatives.variants.length} creative${creatives.variants.length === 1 ? "" : "s"} generated across ${complianceGroups.length} compliance grouping${complianceGroups.length === 1 ? "" : "s"}.` : ""}`
            : "Draft a campaign."
        }
        mod="signal"
        {...(heroChips.length > 0 ? { hero: { chips: heroChips } } : {})}
      />

      {result?.problem ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-4">
          <p className="font-ui text-14 font-medium text-danger">{result.problem.title}</p>
          {result.problem.detail ? <p className="mt-1 font-ui text-13 text-subtle">{result.problem.detail}</p> : null}
        </div>
      ) : null}

      <Card title="Suggest an audience">
        <Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="suggest_audience" />
          <input type="hidden" name="whitespaceId" value={whitespaceId} />
          <label className="flex flex-col gap-1">
            <span className="font-ui text-12 text-subtle">Subject</span>
            <input
              name="subject"
              defaultValue={subject}
              className="rounded-md border border-border bg-surface-2 px-3 py-2 font-ui text-13"
            />
          </label>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={busy}>
              Suggest audience
            </Button>
          </div>
        </Form>
      </Card>

      {audience ? (
        <Card title={audience.proposal.name}>
          <div className="flex flex-col gap-3">
            <p className="font-ui text-13 leading-relaxed text-text">{audience.proposal.summary}</p>
            <div className="flex flex-wrap gap-2">
              {audience.proposal.demographics.map((d, i) => (
                <Badge key={i} tone="neutral" size="sm">
                  {d.axis}: {d.value}
                </Badge>
              ))}
            </div>
            {audience.proposal.reasons.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {audience.proposal.reasons.map((r, i) => (
                  <li key={i} className="font-ui text-12 text-subtle">
                    {r.axis}: {r.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Card>
      ) : null}

      {audience ? (
        <Card title="Generate creatives">
          <Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="generate_creatives" />
            <input type="hidden" name="brief" value={audience.proposal.summary} />
            <p className="font-ui text-13 text-subtle">Brief: {audience.proposal.summary}</p>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={busy}>
                Generate creatives
              </Button>
            </div>
          </Form>
        </Card>
      ) : null}

      {creatives && complianceGroups.length > 1 ? <div>{renderSection(complianceBars, "signal")}</div> : null}

      {creatives ? (
        <div className="flex flex-col gap-3">
          {creatives.variants.map((v) => (
            <Card key={v.id} title={v.locale.toUpperCase()}>
              <div className="flex flex-col gap-2">
                <p className="font-ui text-13 leading-relaxed text-text">{v.text}</p>
                <Badge tone={v.complianceStatus === "passed" ? "success" : "warning"} size="sm">
                  {v.complianceStatus}
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
