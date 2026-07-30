import { Hono } from "hono";
import { z } from "zod";
import { require_, withIdempotency, type Ctx } from "@lyra/core";
import { body } from "../http.js";
import {
  STAGES,
  advancePartner,
  assertSubjectKind,
  blockingSteps,
  completeStep,
  draftAgreement,
  failStep,
  resumePartner,
  sendForSignature,
  signAgreement,
  startOnboarding,
  stepsFor,
  suspendPartner,
  terminatePartner,
  waiveStep,
  type Stage
} from "../engines/onboarding.js";
import type { App } from "../env.js";

// docs/05 §7. Onboarding a counterparty is the process generated CRUD must not
// touch: the steps are generated from a template, the stage is walked by the
// engine, and the two moves that matter — waiving a check, going live — are
// approvals. CRUD exposes the rows read-only (resources.ts); everything that
// changes them comes through here.

export const onboardingRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");

/* ------------------------------------------------------------------ steps */

const StartBody = z.object({
  subjectKind: z.enum(["partner", "channel", "staff"]),
  subjectRef: z.string().min(1),
  template: z.string().min(1),
  /** Role key -> user id, so generated steps land in a named queue. */
  owners: z.record(z.string(), z.string()).optional(),
  dueAt: z.number().int().optional()
});

onboardingRoutes.post("/steps", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:onboarding:write", { tenantId: ctx.tenantId, module: "core" });
  const input = await body(c, StartBody);
  const data = await withIdempotency(ctx, c.req.header("idempotency-key"), "core.onboarding.start", input, () =>
    startOnboarding(ctx, input)
  );
  return c.json({ data }, 201);
});

/** The checklist plus what it is currently blocking — one call, one screen. */
onboardingRoutes.get("/steps", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:onboarding:read", { tenantId: ctx.tenantId, module: "core" });
  const subjectKind = assertSubjectKind(c.req.query("subjectKind") ?? "partner");
  const subjectRef = c.req.query("subjectRef") ?? "";
  const data = await stepsFor(ctx, subjectKind, subjectRef);
  const stage = (c.req.query("stage") as Stage | undefined) ?? STAGES[STAGES.length - 1]!;
  return c.json({ data, blocking: blockingSteps(data, stage).map((s) => s.key) });
});

const CompleteBody = z.object({
  evidenceRef: z.string().min(1).optional(),
  note: z.string().max(2000).optional()
});

onboardingRoutes.post("/steps/:id/complete", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:onboarding:write", { tenantId: ctx.tenantId, module: "core" });
  const input = await body(c, CompleteBody);
  return c.json(await completeStep(ctx, c.req.param("id"), input));
});

const ReasonBody = z.object({ reason: z.string().min(3).max(2000) });

onboardingRoutes.post("/steps/:id/fail", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:onboarding:write", { tenantId: ctx.tenantId, module: "core" });
  const { reason } = await body(c, ReasonBody);
  return c.json(await failStep(ctx, c.req.param("id"), reason));
});

/**
 * Waiving is its own permission, not a stronger form of `write`. The person who
 * runs the checklist is not the person who gets to decide it does not apply.
 */
onboardingRoutes.post("/steps/:id/waive", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:onboarding:waive", { tenantId: ctx.tenantId, module: "core" });
  const { reason } = await body(c, ReasonBody);
  return c.json(await waiveStep(ctx, c.req.param("id"), reason));
});

/* --------------------------------------------------------------- partners */

onboardingRoutes.post("/partners/:id/advance", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "orbit:partners:update", { tenantId: ctx.tenantId, module: "orbit" });
  const partnerId = c.req.param("id");
  return c.json(
    await withIdempotency(
      ctx,
      c.req.header("idempotency-key"),
      "core.onboarding.advance",
      { partnerId },
      () => advancePartner(ctx, partnerId)
    )
  );
});

onboardingRoutes.post("/partners/:id/suspend", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "orbit:partners:update", { tenantId: ctx.tenantId, module: "orbit" });
  const { reason } = await body(c, ReasonBody);
  await suspendPartner(ctx, c.req.param("id"), reason);
  return c.json({ status: "suspended" });
});

onboardingRoutes.post("/partners/:id/resume", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "orbit:partners:update", { tenantId: ctx.tenantId, module: "orbit" });
  await resumePartner(ctx, c.req.param("id"));
  return c.json({ status: "resumed" });
});

onboardingRoutes.post("/partners/:id/terminate", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "orbit:partners:update", { tenantId: ctx.tenantId, module: "orbit" });
  const { reason } = await body(c, ReasonBody);
  await terminatePartner(ctx, c.req.param("id"), reason);
  return c.json({ status: "terminated" });
});

/* ------------------------------------------------------------- agreements */

const DraftBody = z.object({
  partnerId: z.string().min(1),
  kind: z.string().min(1).optional(),
  /** docs/05: settlement, clawbackDays, exclusivity, territories, notice. */
  terms: z.record(z.string(), z.unknown()),
  documentFileId: z.string().optional(),
  effectiveFrom: z.number().int().optional()
});

onboardingRoutes.post("/agreements", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dist:agreements:write", { tenantId: ctx.tenantId, module: "dist" });
  const input = await body(c, DraftBody);
  const row = await withIdempotency(ctx, c.req.header("idempotency-key"), "dist.agreement.draft", input, () =>
    draftAgreement(ctx, input)
  );
  return c.json(row, 201);
});

onboardingRoutes.post("/agreements/:id/send", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dist:agreements:write", { tenantId: ctx.tenantId, module: "dist" });
  return c.json(await sendForSignature(ctx, c.req.param("id")));
});

const SignBody = z.object({
  signedByPartnerName: z.string().min(2).max(200),
  effectiveFrom: z.number().int().optional()
});

/**
 * The route guard is `write`, not `sign`: the drafter asks, and the
 * `dist.agreement_sign` approval — dual control, decided by `dist:agreements:sign`
 * — is what actually binds the tenant. Guarding on `sign` here would let the
 * signatory both raise and clear their own signature.
 */
onboardingRoutes.post("/agreements/:id/sign", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dist:agreements:write", { tenantId: ctx.tenantId, module: "dist" });
  const input = await body(c, SignBody);
  const agreementId = c.req.param("id");
  return c.json(
    await withIdempotency(ctx, c.req.header("idempotency-key"), "dist.agreement.sign", { agreementId, ...input }, () =>
      signAgreement(ctx, agreementId, input)
    )
  );
});
