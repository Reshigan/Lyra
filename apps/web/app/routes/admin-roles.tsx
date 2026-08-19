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
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  GuardrailNotice,
  Input,
  PageHeader,
  Table,
  type Column
} from "@lyra/ui";
import { ApiError, api, fetchMe, type Problem } from "../api.server";
import { cloudflare } from "../context";
import { asJson } from "../json.js";
import { translator } from "../i18n";
import { Gate } from "./staff";
import { useShellData } from "./workspace";
import { labelsFrom } from "./detail-kit";

// The roles editor (docs/06 §1). The generated `roles` tab in modules/admin.ts
// can list roles and can hand an operator a `json` field to type two hundred
// permission strings into by hand; it cannot show which of them a role holds.
// This is that view: one grid per module, resources down, actions across.
//
// Two rules make it safe rather than convenient:
//   * only permissions the acting session itself holds are offered, because
//     PATCH /v1/core/roles has no grant check of its own (resources.ts registers
//     roles with no `beforeWrite`, unlike user-roles) — this tier is the only
//     thing standing between an admin's own ceiling and a role above it;
//   * grants the actor cannot see are preserved verbatim rather than dropped,
//     so saving never silently strips a role of what it had.

/* --------------------------------------------------------------- contract */

export const PERM = {
  read: "core:roles:read",
  write: "core:roles:update"
} as const;

/** `core_roles`, as the generated resource returns it (`*Json` columns hydrated). */
export interface RoleRow {
  id: string;
  key: string;
  name: string;
  permissionsJson: string[] | string;
  system: boolean;
  createdAt: number;
}

/** A role key is used in `user_roles` and in code; keep it machine-shaped. */
const ROLE_KEY = /^[a-z][a-z0-9._-]{1,60}$/;

/**
 * Mirrors `matches` in packages/core/src/rbac.ts — the web app cannot import
 * @lyra/core (same reason approvals.tsx restates the approval states).
 */
export function covers(granted: string, wanted: string): boolean {
  if (granted === wanted) return true;
  const g = granted.split(":");
  const w = wanted.split(":");
  if (g.length !== 3 || w.length !== 3) return false;
  return g.every((seg, i) => seg === "*" || seg === w[i]);
}

/** A role's grant list, whether the column hydrated or came back as raw text. */
export function grantsOf(row: Pick<RoleRow, "permissionsJson">): string[] {
  const raw = asJson<unknown>(row.permissionsJson, []);
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
}

export interface MatrixCell {
  action: string;
  permission: string;
}

export interface MatrixRow {
  resource: string;
  cells: MatrixCell[];
}

export interface MatrixBlock {
  module: string;
  actions: string[];
  rows: MatrixRow[];
}

/**
 * `axis:cases:read` reads as module / resource / action, which is the only
 * structure the permission catalogue offers and the one an operator thinks in.
 * Malformed strings are dropped rather than rendered as a headerless column.
 */
export function matrixOf(permissions: readonly string[]): MatrixBlock[] {
  const byModule = new Map<string, Map<string, MatrixCell[]>>();
  for (const permission of [...permissions].sort()) {
    const [module, resource, action] = permission.split(":");
    if (!module || !resource || !action) continue;
    const resources = byModule.get(module) ?? new Map<string, MatrixCell[]>();
    resources.set(resource, [...(resources.get(resource) ?? []), { action, permission }]);
    byModule.set(module, resources);
  }
  return [...byModule]
    .map(([module, resources]) => ({
      module,
      actions: [...new Set([...resources.values()].flatMap((cells) => cells.map((c) => c.action)))].sort(),
      rows: [...resources].map(([resource, cells]) => ({ resource, cells })).sort((a, b) => a.resource.localeCompare(b.resource))
    }))
    .sort((a, b) => a.module.localeCompare(b.module));
}

/** Grants that are not one of `held` — wildcards included. Preserved on save. */
export function keptGrants(granted: readonly string[], held: ReadonlySet<string>): string[] {
  return granted.filter((g) => !held.has(g));
}

/** The one line under the title: how many roles exist, and how many are custom. */
export function rolesLede(roles: readonly Pick<RoleRow, "system">[], l: (key: string, vars?: Record<string, string>) => string): string {
  if (roles.length === 0) return l("introEmpty");
  const custom = roles.filter((row) => !row.system).length;
  return l("introCount", { count: String(roles.length), custom: String(custom) });
}

/* ----------------------------------------------------------------- labels */

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    title: "Roles and permissions",
    intro:
      "What each role is trusted with. You can grant only what you hold yourself, and the roles that ship with the platform are read-only here.",
    deniedTitle: "You cannot read roles",
    introEmpty: "No roles defined for this organisation yet.",
    introCount: "{count} role(s), {custom} of them custom.",
    listTitle: "Roles",
    listCaption: "Roles defined for this organisation",
    colRole: "Role",
    colKey: "Key",
    colGrants: "Grants",
    kindSystem: "Built in",
    kindCustom: "Custom",
    openFor: "Open the permissions of {name}",
    emptyRoles: "No roles yet.",
    pickPrompt: "Choose a role to see what it may do.",
    matrixTitle: "What {name} may do",
    matrixIntro: "A ticked box is a granted permission. Only the permissions you hold yourself are offered.",
    matrixCaption: "Permissions in the {module} module",
    colResource: "Resource",
    systemTitle: "Read-only role",
    systemReason:
      "This role is provisioned from the platform's own role catalogue, so an edit here would drift from the definition in code.",
    grantsHeld: "Held",
    grantsNone: "No permissions granted yet.",
    grantableNone: "You hold no permissions you could grant.",
    keptTitle: "Kept as they are",
    keptIntro: "Grants outside your own permissions, including wildcards. Saving leaves them untouched.",
    nameLabel: "Display name",
    save: "Save permissions",
    saved: "Permissions saved.",
    newTitle: "New role",
    newIntro: "A custom role starts with nothing. Give it a key, a name, and the permissions it needs.",
    newKey: "Key",
    newKeyHint: "Lower case letters, digits, dots, dashes or underscores.",
    create: "Create role",
    created: "Role created.",
    roleRequired: "Choose a role first.",
    nameRequired: "A role needs a display name.",
    keyRequired: "A role key starts with a letter and uses lower case letters, digits, dots, dashes or underscores.",
    notYours: "That list includes a permission you do not hold, so it was refused.",
    systemLocked: "This role is provisioned by the platform and cannot be edited here.",
    approvalLink: "Open approvals"
  },
  ar: {
    title: "الأدوار والأذونات",
    intro:
      "ما يُؤتمن عليه كل دور. لا يمكنك منح إلا ما تملكه أنت، والأدوار المرفقة مع المنصة تُعرض هنا للقراءة فقط.",
    deniedTitle: "لا يمكنك قراءة الأدوار",
    introEmpty: "لا توجد أدوار معرَّفة لهذه المؤسسة بعد.",
    introCount: "{count} دور، منها {custom} مخصص.",
    listTitle: "الأدوار",
    listCaption: "الأدوار المعرّفة لهذه المؤسسة",
    colRole: "الدور",
    colKey: "المفتاح",
    colGrants: "الأذونات الممنوحة",
    kindSystem: "مضمَّن",
    kindCustom: "مخصص",
    openFor: "افتح أذونات {name}",
    emptyRoles: "لا توجد أدوار بعد.",
    pickPrompt: "اختر دورًا لترى ما يمكنه فعله.",
    matrixTitle: "ما يمكن أن يفعله {name}",
    matrixIntro: "المربع المحدَّد يعني إذنًا ممنوحًا. تُعرض فقط الأذونات التي تملكها أنت.",
    matrixCaption: "الأذونات في وحدة {module}",
    colResource: "المورد",
    systemTitle: "دور للقراءة فقط",
    systemReason: "هذا الدور مُهيَّأ من كتالوج أدوار المنصة، فأي تعديل هنا سيخالف تعريفه في الكود.",
    grantsHeld: "ممنوح",
    grantsNone: "لا أذونات ممنوحة بعد.",
    grantableNone: "لا تملك أذونات يمكنك منحها.",
    keptTitle: "تُترك كما هي",
    keptIntro: "أذونات خارج نطاق أذوناتك، بما فيها أنماط البدل. الحفظ لا يمسّها.",
    nameLabel: "الاسم المعروض",
    save: "احفظ الأذونات",
    saved: "تم حفظ الأذونات.",
    newTitle: "دور جديد",
    newIntro: "الدور المخصص يبدأ فارغًا. امنحه مفتاحًا واسمًا والأذونات التي يحتاجها.",
    newKey: "المفتاح",
    newKeyHint: "حروف لاتينية صغيرة وأرقام ونقاط وشرطات أو شرطات سفلية.",
    create: "أنشئ الدور",
    created: "تم إنشاء الدور.",
    roleRequired: "اختر دورًا أولًا.",
    nameRequired: "الدور يحتاج اسمًا معروضًا.",
    keyRequired: "مفتاح الدور يبدأ بحرف ويستخدم حروفًا لاتينية صغيرة وأرقامًا ونقاطًا وشرطات أو شرطات سفلية.",
    notYours: "القائمة تضم إذنًا لا تملكه، فتم رفضها.",
    systemLocked: "هذا الدور مُهيَّأ من المنصة ولا يمكن تعديله هنا.",
    approvalLink: "افتح الموافقات"
  }
};

/** The shared resolver: the route's own table, then the shared catalogue, then
 *  the platform's `common.*` words (docs/ui.md §7 P3-14). */
export const labelsIn = labelsFrom(LABELS);

/* ------------------------------------------------------------------ loader */

/** A withheld read blanks one card, never the screen. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return fallback;
    throw error;
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const selected = (new URL(request.url).searchParams.get("role") ?? "").trim();
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);
  const may = { read: held.has(PERM.read), write: held.has(PERM.write) };
  const idempotencyKey = crypto.randomUUID();
  if (!may.read) return { may, roles: [] as RoleRow[], grantable: [] as string[], selected, idempotencyKey };

  const roles = await safe(() => api<{ data: RoleRow[] }>("/v1/core/roles?limit=200", { env, request }), { data: [] });
  return {
    may,
    roles: roles.data,
    // /v1/me already expands wildcard bundles to concrete permissions
    // (routes/me.ts), so this is the exact set the actor may pass on.
    grantable: may.write ? [...held].sort() : [],
    selected,
    idempotencyKey
  };
}

/* ------------------------------------------------------------------ action */

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const nothing = { problem: null as Problem | null, error: null as string | null, done: null as string | null };
  const intent = String(form.get("intent") ?? "");
  if (intent !== "save" && intent !== "create") {
    return { ...nothing, problem: { title: "unknown intent", status: 400 } };
  }
  const key = String(form.get("idempotencyKey") ?? "");
  const headers = key ? { "idempotency-key": key } : {};

  const name = String(form.get("name") ?? "").trim();
  if (!name) return { ...nothing, error: "nameRequired" };
  const picked = form.getAll("permissions").map(String);
  // The trust boundary. The form is only a suggestion: the held set comes from
  // the session, and a permission outside it is refused before any write.
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);
  if (picked.some((permission) => !held.has(permission))) return { ...nothing, error: "notYours" };

  try {
    if (intent === "save") {
      const roleId = String(form.get("roleId") ?? "").trim();
      if (!roleId) return { ...nothing, error: "roleRequired" };
      // Re-read rather than trust a hidden field: `system` decides whether this
      // role may be written at all.
      const row = await api<RoleRow>(`/v1/core/roles/${encodeURIComponent(roleId)}`, { env, request });
      if (row.system) return { ...nothing, error: "systemLocked" };
      const permissions = [...new Set([...keptGrants(grantsOf(row), held), ...picked])].sort();
      await api(`/v1/core/roles/${encodeURIComponent(roleId)}`, {
        env,
        request,
        method: "PATCH",
        headers,
        body: { name, permissionsJson: permissions }
      });
      return { ...nothing, done: "saved" };
    }

    const roleKey = String(form.get("key") ?? "").trim();
    if (!ROLE_KEY.test(roleKey)) return { ...nothing, error: "keyRequired" };
    await api("/v1/core/roles", {
      env,
      request,
      method: "POST",
      headers,
      // `core_roles.system` defaults to true, so a role created without this
      // would be born locked and read as one the platform provisioned.
      body: { key: roleKey, name, permissionsJson: [...picked].sort(), system: false }
    });
    return { ...nothing, done: "created" };
  } catch (error) {
    if (error instanceof ApiError) return { ...nothing, problem: error.problem };
    throw error;
  }
}

/* --------------------------------------------------------------- component */

export default function AdminRoles() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const navigation = useNavigation();

  const locale = shell?.locale ?? "en";
  const t = translator(locale);
  const l = labelsIn(locale);
  const busy = navigation.state !== "idle";

  if (!loaded.may.read) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={l("title")} description={l("intro")} />
        <EmptyState title={l("deniedTitle")} body={t("error.forbidden")} />
      </div>
    );
  }

  const role = loaded.roles.find((candidate) => candidate.id === loaded.selected);
  const columns: Array<Column<RoleRow>> = [
    { key: "name", header: l("colRole"), render: (row) => row.name },
    { key: "key", header: l("colKey"), render: (row) => <span className="font-mono text-12">{row.key}</span> },
    {
      key: "system",
      header: l("colKind"),
      render: (row) => (
        <Badge tone={row.system ? "neutral" : "info"} size="sm">
          {l(row.system ? "kindSystem" : "kindCustom")}
        </Badge>
      )
    },
    { key: "grants", header: l("colGrants"), numeric: true, render: (row) => grantsOf(row).length },
    {
      key: "open",
      header: t("common.actions"),
      render: (row) => (
        <Link
          to={`/admin/permissions?role=${encodeURIComponent(row.id)}`}
          aria-label={l("openFor", { name: row.name })}
          className="font-ui text-12 text-accent underline-offset-2 hover:underline"
        >
          {l("open")}
        </Link>
      )
    }
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={l("title")} title={rolesLede(loaded.roles, l)} description={l("intro")} />

      {result?.error ? (
        <p role="alert" className="font-ui text-13 text-danger">
          {l(result.error)}
        </p>
      ) : null}
      {result?.problem ? <Gate problem={result.problem} l={l} /> : null}
      {result?.done ? (
        <p role="status" className="font-ui text-13 text-success">
          {l(result.done)}
        </p>
      ) : null}

      <Card title={l("listTitle")} description={l("listCaption")}>
        <Table
          caption={l("listCaption")}
          columns={columns}
          rows={loaded.roles}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("emptyRoles")} />}
        />
      </Card>

      {role ? (
        <RoleMatrix
          role={role}
          grantable={loaded.grantable}
          mayWrite={loaded.may.write}
          idempotencyKey={loaded.idempotencyKey}
          busy={busy}
          l={l}
          t={t}
        />
      ) : (
        <p className="font-ui text-13 text-subtle">{l("pickPrompt")}</p>
      )}

      {loaded.may.write ? (
        <NewRoleForm grantable={loaded.grantable} idempotencyKey={loaded.idempotencyKey} busy={busy} l={l} t={t} />
      ) : null}
    </div>
  );
}

/**
 * The grid. One table per module so the action columns stay meaningful — a
 * single table across every module would be mostly empty cells.
 */
function RoleMatrix({
  role,
  grantable,
  mayWrite,
  idempotencyKey,
  busy,
  l,
  t
}: {
  role: RoleRow;
  grantable: string[];
  mayWrite: boolean;
  idempotencyKey: string;
  busy: boolean;
  l: (key: string, vars?: Record<string, string>) => string;
  t: (key: string, vars?: Record<string, string>) => string;
}) {
  const granted = grantsOf(role);
  const held = new Set(grantable);
  const kept = keptGrants(granted, held);
  const editable = mayWrite && !role.system;
  // A read-only role still shows what it holds: its own grants, expanded no
  // further than the strings the API stores.
  const blocks = matrixOf(editable ? grantable : granted);
  const isGranted = (permission: string) => granted.some((g) => covers(g, permission));

  return (
    <Card title={l("matrixTitle", { name: role.name })} description={l("matrixIntro")}>
      <div className="flex flex-col gap-4">
        {role.system ? <GuardrailNotice title={l("systemTitle")} reason={l("systemReason")} tone="info" /> : null}

        {blocks.length === 0 ? (
          <EmptyState title={l(editable ? "grantableNone" : "grantsNone")} />
        ) : null}

        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="roleId" value={role.id} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

          <Field label={l("nameLabel")} required>
            <Input name="name" defaultValue={role.name} maxLength={120} readOnly={!editable} required />
          </Field>

          {blocks.map((block) => (
            <details key={block.module} className="rounded-md border border-border p-3" open={blocks.length < 3}>
              <summary className="cursor-pointer font-ui text-13 text-text">
                {`${block.module} (${block.rows.length})`}
              </summary>
              <div className="mt-3">
                <Table
                  caption={l("matrixCaption", { module: block.module })}
                  density="compact"
                  columns={[
                    {
                      key: "resource",
                      header: l("colResource"),
                      render: (row: MatrixRow) => <span className="font-mono text-12">{row.resource}</span>
                    },
                    ...block.actions.map((action) => ({
                      key: action,
                      header: action,
                      render: (row: MatrixRow) => {
                        const cell = row.cells.find((candidate) => candidate.action === action);
                        if (!cell) return <span className="font-ui text-12 text-subtle">—</span>;
                        return editable ? (
                          <Checkbox
                            name="permissions"
                            value={cell.permission}
                            label={cell.permission}
                            defaultChecked={isGranted(cell.permission)}
                            className="[&>label]:sr-only"
                          />
                        ) : (
                          <Badge tone={isGranted(cell.permission) ? "success" : "neutral"} size="sm">
                            {isGranted(cell.permission) ? l("grantsHeld") : "—"}
                          </Badge>
                        );
                      }
                    }))
                  ]}
                  rows={block.rows}
                  rowKey={(row) => row.resource}
                />
              </div>
            </details>
          ))}

          {kept.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
              <h3 className="font-display text-14 text-text">{l("keptTitle")}</h3>
              <p className="max-w-prose font-ui text-12 text-subtle">{l("keptIntro")}</p>
              <div className="flex flex-wrap gap-2">
                {kept.map((permission) => (
                  <code key={permission} className="font-mono text-12 text-muted">
                    {permission}
                  </code>
                ))}
              </div>
            </div>
          ) : null}

          {editable ? (
            <div>
              <Button type="submit" variant="primary" loading={busy}>
                {busy ? t("common.working") : l("save")}
              </Button>
            </div>
          ) : null}
        </Form>
      </div>
    </Card>
  );
}

function NewRoleForm({
  grantable,
  idempotencyKey,
  busy,
  l,
  t
}: {
  grantable: string[];
  idempotencyKey: string;
  busy: boolean;
  l: (key: string, vars?: Record<string, string>) => string;
  t: (key: string, vars?: Record<string, string>) => string;
}) {
  const blocks = matrixOf(grantable);

  return (
    <Card title={l("newTitle")} description={l("newIntro")}>
      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="create" />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={l("newKey")} hint={l("newKeyHint")} required>
            <Input name="key" maxLength={61} required />
          </Field>
          <Field label={l("nameLabel")} required>
            <Input name="name" maxLength={120} required />
          </Field>
        </div>

        {blocks.length === 0 ? (
          <p className="font-ui text-12 text-subtle">{l("grantableNone")}</p>
        ) : (
          // <details> because an administrator's own catalogue runs to hundreds.
          blocks.map((block) => (
            <details key={block.module} className="rounded-md border border-border p-2">
              <summary className="cursor-pointer font-ui text-13 text-text">
                {`${block.module} (${block.rows.reduce((n, row) => n + row.cells.length, 0)})`}
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {block.rows.flatMap((row) =>
                  row.cells.map((cell) => (
                    <Checkbox key={cell.permission} name="permissions" value={cell.permission} label={cell.permission} />
                  ))
                )}
              </div>
            </details>
          ))
        )}

        <div>
          <Button type="submit" variant="primary" loading={busy}>
            {busy ? t("common.working") : l("create")}
          </Button>
        </div>
      </Form>
    </Card>
  );
}
