import type { DurableObject as DurableObjectType } from "cloudflare:workers";
import { id, makeDb, EntitlementsJson, PolicyJson } from "@lyra/db";
import { applyTurn, checkpoint, openRoom, type RoomState, type RoomTurn } from "./orbit-room.js";
import { ctxFor } from "../auth.js";
import { gatewayFor } from "../mw.js";
import { embedUpsert } from "./vectorize.js";
import type { Env } from "../env.js";

// docs/16 H3 / docs/02 §4 / docs/10 §2 (`AGENT_ROOM` binding): the AgentRoom
// Durable Object, one instance per conversation (keyed by `${tenantId}:${
// conversationId}`, see routes/orbit.ts). Everything this class does is
// orbit-room.ts's `applyTurn`/`checkpoint` — kept that way so the actual logic
// is unit-testable without a Workers runtime (see the module comment there).
//
// `tsc` type-checks a *type-only* import of "cloudflare:workers" fine (it's an
// ambient module in @cloudflare/workers-types, no real file needed) — but a
// runtime `import { DurableObject } from "cloudflare:workers"` crashes plain
// Node/tsx with ERR_UNSUPPORTED_ESM_URL_SCHEME, because only workerd resolves
// the `cloudflare:` protocol. That's the *actual* on-prem boot path
// (`pnpm --filter @lyra/api start` → src/node.ts, docs/11 §3) and Playwright's
// e2e webServer, not just a test-only concern — vitest.config.ts's alias to
// cloudflare-workers.stub.ts only covers vitest's own module runner. So the
// base class is resolved at runtime via the same stub, and the real
// "cloudflare:workers" is used only for the type.
const { DurableObject } = (await import("cloudflare:workers").catch(
  () => import("./cloudflare-workers.stub.js")
)) as { DurableObject: typeof DurableObjectType };

export class AgentRoom extends DurableObject<Env> {
  private room: RoomState | null = null;

  /**
   * Append one turn and checkpoint immediately. A later revision that streams
   * multiple internal steps per turn (tool calls, deltas) can hold them in
   * `this.room.pending` across several `applyTurn` calls and only checkpoint
   * once the exchange completes — the reducer already supports that, this
   * wrapper just doesn't need it yet for a single-message turn.
   */
  async turn(input: { tenantId: string; conversationId: string } & RoomTurn): Promise<{ turnCount: number; pending: number }> {
    if (!this.room || this.room.tenantId !== input.tenantId || this.room.conversationId !== input.conversationId) {
      this.room = openRoom(input.tenantId, input.conversationId);
    }
    this.room = applyTurn(this.room, {
      role: input.role,
      content: input.content,
      modality: input.modality,
      aiAuditId: input.aiAuditId,
      ts: input.ts
    });
    const flushing = this.room.pending;
    // ponytail: same `as never` the scheduled handler already uses to hand a
    // real Db to a CoreDb-typed function (index.ts) — D1's inferred schema
    // type is stricter than CoreDb's, not a real mismatch.
    this.room = await checkpoint(makeDb(this.env.DB) as never, this.room, Date.now());
    await this.embedFlushed(input.tenantId, input.conversationId, flushing);
    return { turnCount: this.room.turnCount, pending: this.room.pending.length };
  }

  /**
   * ORBIT conversation memory (docs/03 VEC_CONVO). Runs after checkpoint has
   * committed, so a failed embed never blocks a turn from landing — same
   * system-actor Ctx shape index.ts's queue()/scheduled() handlers use, since
   * a Durable Object method has no request to build a real one from.
   */
  private async embedFlushed(tenantId: string, conversationId: string, turns: RoomTurn[]): Promise<void> {
    if (!this.env.VEC_CONVO || turns.length === 0) return;
    const ctx = await ctxFor(
      this.env,
      {
        tenantId,
        locale: "en",
        actor: { kind: "system", id: "agent-room", tenantId, grants: [] },
        policy: PolicyJson.parse({}),
        entitlements: EntitlementsJson.parse({})
      },
      Date.now()
    );
    const gateway = gatewayFor(this.env);
    for (const turn of turns) {
      await embedUpsert(ctx, gateway, this.env.VEC_CONVO, {
        module: "orbit",
        purpose: "orbit.message.embed",
        id: id("msg", turn.ts),
        text: turn.content,
        metadata: { tenantId, conversationId, role: turn.role, text: turn.content.slice(0, 1000) }
      });
    }
  }
}
