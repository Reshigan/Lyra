import { and, eq } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { audit, type Ctx, type Envelope } from "@lyra/core";

// F61. A data subject who files a DSAR through the public portal gets no
// acknowledgement: the route emits `compliance.dsar-requests.created` and
// nothing in the tree subscribes to it. This consumer is the subscriber.
//
// It notifies every user holding the tenant.compliance role that a request
// arrived and is due, so the queue is never empty of owners. The subject
// themselves already received a 202 with a reference and due date from the
// portal route; this closes the internal half of the loop.

const KIND = "compliance.dsar.created";
const TITLE_KEY = "compliance.dsar.created";
const ROLE_KEY = "tenant.compliance";

interface DsarCreatedData {
  id?: string;
  type?: string;
  via?: string;
}

/** Users holding the compliance role — the ones who must action the request. */
async function complianceStaff(ctx: Ctx): Promise<string[]> {
  const rows = await ctx.db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(
      and(
        eq(schema.userRoles.tenantId, ctx.tenantId),
        eq(schema.roles.key, ROLE_KEY),
        eq(schema.roles.tenantId, ctx.tenantId)
      )
    );
  return [...new Set(rows.map((r) => r.userId))];
}

export async function onDsarCreated(ctx: Ctx, envelope: Envelope): Promise<void> {
  const data = envelope.data as DsarCreatedData;
  const dsarId = data.id ?? envelope.subject;
  if (!dsarId) return;

  const staff = await complianceStaff(ctx);
  if (!staff.length) return;

  const rows = staff.map((userId) => ({
    id: newId("ntf", ctx.now),
    tenantId: ctx.tenantId,
    userId,
    kind: KIND,
    titleKey: TITLE_KEY,
    paramsJson: JSON.stringify({ type: data.type ?? "access", via: data.via ?? "portal" }),
    subjectRef: dsarId,
    readAt: null,
    createdAt: ctx.now
  }));
  await ctx.db.insert(schema.notifications).values(rows);

  await audit(ctx, {
    action: "compliance.dsar.acknowledged",
    subjectRef: `dsar-requests:${dsarId}`,
    after: { notified: staff.length }
  });
}
