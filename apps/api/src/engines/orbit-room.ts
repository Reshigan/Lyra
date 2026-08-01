import { and, eq } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import type { CoreDb } from "@lyra/core";

// docs/16 H3 + docs/02 §4: AgentRoom is a Durable Object, one per conversation,
// that holds transcript state in memory during a live exchange so a multi-step
// turn (tool calls, streamed deltas) does not round-trip the DB per step — it
// writes once, at turn completion. The DB stays the source of truth (rule 15
// says build to the seam, not replace what already works): the DO never holds
// anything that isn't also checkpointed here.
//
// This file is the seam's actual logic, kept framework-agnostic on purpose.
// Durable Objects need a Workers runtime to instantiate, and this repo has no
// @cloudflare/vitest-pool-workers (or miniflare) harness to run one in tests —
// so the reducer and the persist step live here, as plain functions callable
// from the same libsql-backed harness every other packages/core/apps/api test
// uses (see orbit-room.test.ts). engines/agent-room.ts is a thin wrapper: the
// DurableObject class itself has no logic left to get wrong.

export type RoomRole = "customer" | "agent_ai" | "agent_human" | "system";
export type RoomModality = "text" | "voice" | "image" | "document";

export interface RoomTurn {
  role: RoomRole;
  content: string;
  modality?: RoomModality | undefined;
  /** Links a drafted/sent AI turn to its ai_audit_log row (orbit_messages.ai_audit_id). */
  aiAuditId?: string | undefined;
  ts: number;
}

export interface RoomState {
  tenantId: string;
  conversationId: string;
  /** Turns appended since the last checkpoint, oldest first. */
  pending: RoomTurn[];
  /** Total turns this room instance has ever seen (survives checkpoints, not DO eviction). */
  turnCount: number;
}

export function openRoom(tenantId: string, conversationId: string): RoomState {
  return { tenantId, conversationId, pending: [], turnCount: 0 };
}

/** Append one turn to the in-memory transcript. Pure — no I/O, so it is the unit under test. */
export function applyTurn(state: RoomState, turn: RoomTurn): RoomState {
  return { ...state, pending: [...state.pending, turn], turnCount: state.turnCount + 1 };
}

/**
 * Flush every pending turn to `orbit_messages` and bump `orbit_conversations`,
 * then return the state with `pending` cleared. A no-op (not even a
 * transaction) when there is nothing pending, so a stray checkpoint call is
 * free. Tenant-scoped by hand rather than via `scoped()`/`Ctx`: a Durable
 * Object is not a request handler and has no Actor/policy/entitlements to
 * build a real Ctx from, so this filters on tenantId directly — the same
 * WHERE `scoped()` would have produced, since neither orbit table carries a
 * soft-delete column.
 */
export async function checkpoint(db: CoreDb, state: RoomState, now: number): Promise<RoomState> {
  if (state.pending.length === 0) return state;

  for (const turn of state.pending) {
    await db.insert(schema.orbitMessages).values({
      id: newId("msg", turn.ts),
      tenantId: state.tenantId,
      conversationId: state.conversationId,
      role: turn.role,
      modality: turn.modality ?? "text",
      content: turn.content,
      aiAuditId: turn.aiAuditId ?? null,
      ts: turn.ts
    });
  }

  const last = state.pending[state.pending.length - 1]!;
  await db
    .update(schema.orbitConversations)
    .set({ lastMessageAt: last.ts, updatedAt: now })
    .where(
      and(eq(schema.orbitConversations.tenantId, state.tenantId), eq(schema.orbitConversations.id, state.conversationId))
    );

  return { ...state, pending: [] };
}
