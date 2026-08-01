// ponytail: stand-in for the "cloudflare:workers" module. Only workerd
// resolves the real `cloudflare:` protocol; both plain vitest (no
// @cloudflare/vitest-pool-workers here, docs/13) and plain Node/tsx
// (src/node.ts, the on-prem entrypoint, docs/11 §3) do not. vitest.config.ts
// aliases the bare specifier to this file for its own module runner, and
// engines/agent-room.ts falls back to a dynamic `import()` of this same file
// at runtime everywhere else non-workerd (see the comment there) — so both
// paths give `class AgentRoom extends DurableObject<Env>` something to
// extend. Never used under wrangler: it resolves the real "cloudflare:workers"
// natively and never reaches either of these.
export abstract class DurableObject<Env = unknown> {
  protected ctx: unknown;
  protected env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

// Same reasoning, for engines/renewal-workflow.ts's `RenewalWorkflow`. `run`
// is abstract here (unlike DurableObject, which has no required method) so a
// stub instantiation without an override still fails loudly instead of
// silently no-op-ing.
export abstract class WorkflowEntrypoint<Env = unknown, T = unknown> {
  protected ctx: unknown;
  protected env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  abstract run(event: { payload: T }, step: unknown): Promise<unknown>;
}
