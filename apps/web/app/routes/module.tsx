import { useEffect, useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import { Button, EmptyState, Input, Select, Table, type Column } from "@lyra/ui";
import { ApiError, api, asRouteError, fetchMe } from "../api.server";
import { Cell, FieldInput } from "../components/fields";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import { workspaceFor } from "../modules";
import {
  bodyFrom,
  labelsFor,
  optionLabel,
  tabOf,
  visibleLinks,
  visibleTabs,
  type ResourceSpec,
  type Row,
  type WorkspaceSpec
} from "../modules/spec";
import { labelKeyFor } from "../routing";
import { useShellData } from "./workspace";

// The list screen for every declared resource in every workspace. One file,
// because a list is a list: tabs the actor may read, a filter bar, a table, a
// keyset pager and — where the actor holds the permission — a create form.
// Anything that needs more than that gets its own route and links in from here.

interface Page {
  data: Row[];
  cursor?: string;
  total?: number;
}

/** Query keys the API reserves; everything else is an exact-match column filter. */
const RESERVED = ["q", "cursor", "sort", "order"] as const;

function resolve(params: { module?: string; resource?: string }): {
  spec: WorkspaceSpec;
  tab: ResourceSpec;
} {
  const spec = workspaceFor(`/${params.module ?? ""}`);
  if (!spec) throw data("workspace", { status: 404 });
  const tab = tabOf(spec, params.resource);
  if (!tab) throw data("resource", { status: 404 });
  return { spec, tab };
}

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { spec, tab } = resolve(params);
  const env = context.get(cloudflare).env;
  const incoming = new URL(request.url).searchParams;

  const query = new URLSearchParams();
  for (const key of RESERVED) {
    const value = incoming.get(key);
    if (value) query.set(key, value);
  }
  if (!query.has("sort") && tab.sort) {
    query.set("sort", tab.sort);
    query.set("order", tab.order ?? "desc");
  }
  for (const filter of tab.filters ?? []) {
    const value = incoming.get(filter.name);
    if (value) query.set(filter.name, value);
  }

  // `deleted` deliberately sits outside RESERVED's pass-through. The API parses
  // it with `z.coerce.boolean()` (ListQuery, apps/api/src/http.ts), which is
  // `Boolean(value)` — so "false" and "0" would both switch the deleted view ON.
  // Only an explicit "1" opts in, and the parameter is otherwise never sent.
  const deleted = incoming.get("deleted") === "1";
  if (deleted) query.set("deleted", "1");

  const page = await api<Page>(`${tab.api}?${query.toString()}`, { env, request }).catch(
    async (error: unknown) => {
      // `/admin` with no resource lands on the first declared tab, which is not
      // always a tab this actor may read — a compliance officer's first
      // readable admin tab may be the fifth. Rather than tell them the whole
      // workspace is closed, send them to the first one they do hold.
      if (error instanceof ApiError && error.status === 403 && !params.resource) {
        const me = await fetchMe(env, request).catch(asRouteError);
        const readable = visibleTabs(spec, me.permissions).find((other) => other.key !== tab.key);
        if (readable) throw redirect(`${spec.path}/${readable.key}`);
      }
      return asRouteError(error);
    }
  );

  return {
    modulePath: spec.path,
    resource: tab.key,
    rows: page.data ?? [],
    cursor: page.cursor ?? null,
    deleted,
    query: Object.fromEntries(query)
  };
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const { tab } = resolve(params);
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");

  try {
    if (intent === "create") {
      const created = await api<Record<string, unknown>>(tab.api, {
        env,
        request,
        method: "POST",
        body: bodyFrom(tab.fields ?? [], form)
      });
      // Straight back to this render, never a redirect: the create response is
      // the only place a minted secret ever appears (apps/api/src/resources.ts
      // strips it from every read).
      const revealed = tab.revealOnCreate ? created[tab.revealOnCreate] : undefined;
      if (typeof revealed === "string" && revealed) return { problem: null, revealed };
    } else if (intent === "delete" && id) {
      await api(`${tab.api}/${id}`, { env, request, method: "DELETE" });
    } else if (intent === "restore" && id) {
      // The API gates restore on the resource's `remove` permission — the same
      // one delete uses (apps/api/src/crud.ts, the `perm` closed over by both
      // `DELETE /:id` and `POST /:id/restore`).
      await api(`${tab.api}/${id}/restore`, { env, request, method: "POST" });
    } else {
      return { problem: { title: "unknown intent", status: 400 }, revealed: null };
    }
  } catch (error) {
    // A rejected write is information, not a crash: keep the actor on the page
    // with their input intact and show what the API objected to.
    if (error instanceof ApiError) return { problem: error.problem, revealed: null };
    throw error;
  }
  return { problem: null, revealed: null };
}

export default function ModuleList() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const problem = result?.problem ?? null;
  // Lives for exactly one render — a reload or a second create clears it.
  const revealed = result?.revealed ?? null;
  const shell = useShellData();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();

  const locale = shell?.locale ?? "en";
  const permissions = shell?.permissions ?? [];
  const t = translator(locale, shell?.overrides);
  const spec = workspaceFor(loaded.modulePath);
  if (!spec) return null;
  const tab = tabOf(spec, loaded.resource);
  if (!tab) return null;
  const label = labelsFor(spec, locale, shell?.domainPack);
  const held = new Set(permissions);

  const tabs = visibleTabs(spec, permissions);
  const links = visibleLinks(spec, permissions);
  const rows = loaded.rows;
  const busy = navigation.state !== "idle";

  // Nothing in the spec says whether a resource has a `deletedAt` column, so
  // the actor's `remove` permission stands in for soft-deletability: the API
  // only registers restore for soft-deleting resources and gates both the
  // `?deleted` list and the restore route on exactly this permission
  // (apps/api/src/crud.ts). A hard-deleting resource answers 400, so the toggle
  // is offered only to the actor who could have caused a deletion in the first
  // place. Add a `softDelete` flag to ResourceSpec if that ever proves too wide.
  const canRestore = Boolean(tab.remove && held.has(tab.remove));
  const deletedView = loaded.deleted;

  const columns: Array<Column<Row>> = tab.columns.map((column, index) => ({
    key: column.name,
    header: label(column.name),
    sortable: column.sortable ?? false,
    numeric: column.type === "money" || column.type === "number",
    render: (row: Row) =>
      // The first column is the way into the record — one predictable target
      // per row beats a whole-row click nobody can reach from a keyboard. A
      // deleted row has no record page to open (the record loader reads the
      // live scope and would 404), so it stays plain text until restored.
      index === 0 && !deletedView ? (
        <Link
          to={`${spec.path}/${tab.key}/${String(row.id)}`}
          className="font-medium text-text underline-offset-2 hover:underline"
        >
          <Cell column={column} row={row} locale={locale} label={label} />
        </Link>
      ) : (
        <Cell column={column} row={row} locale={locale} label={label} />
      )
  }));

  if (deletedView && canRestore) {
    columns.push({
      key: "restore",
      header: t("common.actions"),
      render: (row: Row) => (
        <Form method="post">
          <input type="hidden" name="intent" value="restore" />
          <input type="hidden" name="id" value={String(row.id)} />
          <Button type="submit" variant="secondary" size="sm">
            {t("common.restore")}
          </Button>
        </Form>
      )
    });
  }

  const sortKey = loaded.query.sort;
  const filtered = (tab.filters ?? []).some((filter) => searchParams.get(filter.name)) ||
    Boolean(searchParams.get("q"));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <h1 className="font-serif text-24 leading-[1.2] text-text">{t(labelKeyFor(spec.path))}</h1>

        {tabs.length > 1 ? (
          <nav aria-label={t("common.tabs")}>
            <ul className="flex flex-wrap gap-1">
              {tabs.map((entry) => {
                const current = entry.key === tab.key;
                return (
                  <li key={entry.key}>
                    <Link
                      to={`${spec.path}/${entry.key}`}
                      aria-current={current ? "page" : undefined}
                      className={[
                        "inline-flex h-8 items-center rounded-md px-3 font-ui text-13 transition-colors duration-150",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        current
                          ? "bg-surface-2 font-medium text-text"
                          : "text-subtle hover:bg-surface-2 hover:text-text"
                      ].join(" ")}
                    >
                      {label(entry.key)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}

        {/* Screens this workspace owns that are not lists — a report is a query
            over the rows, not a page of them. They sit under the tabs because
            they are siblings of the tabs, not one of them. Filtered like the
            tabs: a link to a screen this actor cannot open is not offered. */}
        {links.length ? (
          <nav aria-label={t("common.reports")} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {links.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className="font-ui text-12 text-subtle underline-offset-4 hover:text-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {label(link.labelKey)}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      {/* Deleted rows look nothing like live ones: the list is banded, says so
          in words, and offers the way back. */}
      {deletedView ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2"
        >
          <p className="font-ui text-13 text-text">{t("common.deleted.notice")}</p>
          <Link
            to={`${spec.path}/${tab.key}`}
            className="font-ui text-13 text-text underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t("common.deleted.back")}
          </Link>
        </div>
      ) : null}

      {tab.search || tab.filters?.length || canRestore ? (
        <Form
          method="get"
          {...(tab.search ? { role: "search" } : {})}
          className="flex flex-wrap items-end gap-3"
        >
          {tab.search ? (
            <Input
              type="search"
              name="q"
              defaultValue={searchParams.get("q") ?? ""}
              aria-label={t("common.search")}
              placeholder={t("common.search")}
              className="w-64"
            />
          ) : null}
          {(tab.filters ?? []).map((filter) => (
            <Select
              key={filter.name}
              name={filter.name}
              aria-label={label(filter.name)}
              defaultValue={searchParams.get(filter.name) ?? ""}
              placeholder={label(filter.name)}
              options={[
                { value: "", label: t("common.all") },
                ...filter.options.map((option) => ({
                  value: option,
                  label: optionLabel(label, filter.name, option)
                }))
              ]}
            />
          ))}
          {canRestore ? (
            <Select
              name="deleted"
              aria-label={t("common.deleted.state")}
              defaultValue={deletedView ? "1" : ""}
              placeholder={t("common.deleted.live")}
              options={[
                { value: "", label: t("common.deleted.live") },
                { value: "1", label: t("common.deleted.only") }
              ]}
            />
          ) : null}
          <Button type="submit" variant="secondary" loading={busy}>
            {t("common.apply")}
          </Button>
          {filtered ? (
            <Button asChild variant="ghost">
              <Link to={`${spec.path}/${tab.key}`}>{t("common.clear")}</Link>
            </Button>
          ) : null}
        </Form>
      ) : null}

      {/* A rejected write and the form that caused it stay together, above the
          table: the actor reads the objection where they typed, not after a
          screen of rows. */}
      {problem ? <Problem problem={problem} /> : null}

      {revealed ? (
        <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-surface-2 p-3">
          <h3 className="font-display text-14 text-text">{t("common.reveal.title")}</h3>
          <p className="max-w-prose font-ui text-12 text-subtle">{t("common.reveal.body")}</p>
          {/* Selectable text, not an input: nothing here should look editable,
              and a screen reader should read it as the value it is. */}
          <code role="status" className="break-all font-mono text-13 text-text">
            {revealed}
          </code>
        </div>
      ) : null}

      {tab.fields && tab.create && held.has(tab.create) && !deletedView ? (
        <CreatePanel tab={tab} label={label} t={t} busy={busy} defaultOpen={Boolean(problem)} />
      ) : null}

      <Table
        columns={columns}
        rows={rows}
        rowKey={(row) => String(row.id)}
        caption={
          deletedView
            ? `${t(labelKeyFor(spec.path))} — ${label(tab.key)} — ${t("common.deleted.only")}`
            : `${t(labelKeyFor(spec.path))} — ${label(tab.key)}`
        }
        density="compact"
        stickyHeader
        {...(sortKey
          ? { sort: { key: sortKey, direction: (loaded.query.order ?? "desc") as "asc" | "desc" } }
          : {})}
        onSortChange={(next) => {
          const params = new URLSearchParams(searchParams);
          params.set("sort", next.key);
          params.set("order", next.direction);
          params.delete("cursor");
          setSearchParams(params);
        }}
        empty={
          <EmptyState
            title={deletedView ? t("common.deleted.only") : t("common.empty.title")}
            body={
              deletedView
                ? t("common.empty.deleted")
                : filtered
                  ? t("common.empty.filtered")
                  : t("common.empty.body")
            }
          />
        }
        footer={
          <div className="flex items-center justify-between gap-3 pt-3">
            <span className="font-ui text-12 tabular-nums text-subtle">
              {t("common.rows", { count: String(rows.length) })}
            </span>
            <div className="flex gap-2">
              {searchParams.get("cursor") ? (
                <Button asChild variant="secondary" size="sm">
                  {/* Back to the top of *this* view: dropping the cursor alone
                      keeps the filters and the deleted/live switch. */}
                  <Link to={`?${firstPage(searchParams)}`}>{t("common.previous")}</Link>
                </Button>
              ) : null}
              {loaded.cursor ? (
                <Button asChild variant="secondary" size="sm">
                  <Link to={`?${nextPage(searchParams, loaded.cursor)}`}>{t("common.next")}</Link>
                </Button>
              ) : null}
            </div>
          </div>
        }
      />
    </div>
  );
}

/**
 * Keyset paging is forward-only here: the cursor the API returns opens the next
 * page, and "Previous" goes back to the top of the list.
 * ponytail: a cursor stack would give true back-paging — add it when a screen
 * proves it needs to walk backwards rather than re-filter.
 */
function nextPage(current: URLSearchParams, cursor: string): string {
  const params = new URLSearchParams(current);
  params.set("cursor", cursor);
  return params.toString();
}

/** The same view, back at the first page. */
function firstPage(current: URLSearchParams): string {
  const params = new URLSearchParams(current);
  params.delete("cursor");
  return params.toString();
}

/**
 * Creation lives above the table, closed by default and re-opened when the API
 * rejected the last attempt — `<details>` does the disclosure, so there is no
 * open/closed state to keep in sync and no modal between the actor and the list.
 */
function CreatePanel({
  tab,
  label,
  t,
  busy,
  defaultOpen
}: {
  tab: ResourceSpec;
  label: (key: string) => string;
  t: (key: string, vars?: Record<string, string>) => string;
  busy: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group rounded-lg border border-border bg-surface-1"
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 font-ui text-13 text-text marker:content-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <span
          aria-hidden="true"
          className="text-subtle transition-transform duration-150 group-open:rotate-45"
        >
          +
        </span>
        {t("common.new")} — {label(tab.key)}
      </summary>
      <Form method="post" className="flex flex-col gap-4 border-t border-border p-4">
        <input type="hidden" name="intent" value="create" />
        <div className="grid gap-4 sm:grid-cols-2">
          {(tab.fields ?? []).map((field) => (
            <FieldInput key={field.name} field={field} label={label} />
          ))}
        </div>
        <div>
          <Button type="submit" loading={busy}>
            {t("common.create")}
          </Button>
        </div>
      </Form>
    </details>
  );
}

/**
 * Titles the routes themselves raise, rather than the API. These are the one
 * class of problem whose wording we own, so they are translated here — at the
 * single place every route renders a refusal — instead of in each of the
 * twenty-odd `action`s that can produce one.
 */
const LOCAL_PROBLEM_TITLES: Record<string, "error.unknownIntent"> = {
  "unknown intent": "error.unknownIntent",
  unknown_intent: "error.unknownIntent"
};

/** What the API objected to, in the actor's path rather than a toast. */
export function Problem({ problem }: { problem: { title: string; detail?: string; requestId?: string } }) {
  const shell = useShellData();
  const t = translator(shell?.locale ?? "en");
  const local = LOCAL_PROBLEM_TITLES[problem.title];
  return (
    <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3">
      <p className="font-ui text-13 text-text">
        {local ? t(local) : (problem.detail ?? problem.title)}
      </p>
      {problem.requestId ? (
        <p className="font-mono text-12 text-muted">{t("error.requestId", { id: problem.requestId })}</p>
      ) : null}
    </div>
  );
}

/**
 * A refusal, told apart: an action gated for approval (CLAUDE.md §4) is not a
 * failure — the work is queued, waiting on a second pair of eyes — so it reads
 * as a notice with the way onward, not as a red box with a policy key in it.
 * Anything else stays a <Problem>.
 */
export function Gate({
  problem,
  l
}: {
  problem: { title: string; status: number; detail?: string; requestId?: string };
  l: (key: string, vars?: Record<string, string>) => string;
}) {
  const extras = problem as { code?: string; policy_key?: string };
  if (problem.status === 403 && extras.code === "approval_required") {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/8 p-4">
        <span className="font-ui text-14 font-medium text-warning">{l("approvalTitle")}</span>
        <span className="font-ui text-13 text-muted">
          {l("approvalBody", { policy: extras.policy_key ?? problem.detail ?? problem.title })}
        </span>
        <Link to="/approvals" className="font-ui text-13 text-accent underline underline-offset-2">
          {l("approvalLink")}
        </Link>
      </div>
    );
  }
  return <Problem problem={problem} />;
}
