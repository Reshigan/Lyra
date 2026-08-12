# ADR-0057 — Home is composed by permission, not by a role layout table

Date: 2026-08-12
Status: accepted

## Context

The Horizon comp shows home as a screen that reads differently for a claims
agent, a controller and an executive. The obvious reading of that is a layout
table: role → panel list → order. It is also the reading that ages worst — a
role added in RBAC then has to be added again in the web app, and a role with
two hats gets whichever row the table was written for first.

Home already composes itself from three facts the actor carries:

- **Permissions.** `panel(permitted, fetch)` in `routes/home.tsx` returns
  `{state: "denied"}` without a network call. Economics and areas need
  `analytics:reports:read`; the activity feed needs `core:audit:read`; agent
  runs need `ai:runs:read`.
- **The nav the API already filtered.** "Your workspaces" and the module
  groups are `me.nav`, so a rail entry and a home tile can never disagree.
- **The actor's own queue.** `/v1/me/inbox` is theirs, so the shift block, the
  headline sentence and the day strip differ per person by construction.

Shot as three personas, home is already three screens:

| Persona | Headline | Panel groups |
| --- | --- | --- |
| Hala Zayed (`north.exec`) | "Nothing is waiting on you." | shift, modules, records & finance, decisions, workspaces — plus economics and "Where the work is" |
| Nadia Rahman (`finance.controller`) | "There is work waiting on your decision." | no modules group at all |
| Noor Jamal (`signal.lead`) | "There is work waiting on your decision." | modules group, no activity feed |

## Decision

No role→layout table. Home stays composed from permissions, `me.nav` and the
actor's inbox. A panel earns its place on the screen by the actor holding the
permission that fills it.

A screen that wants to be different for a role expresses that as a permission
on the data it shows, which is a fact the API can enforce, rather than as a
list of role names in the web app, which is a fact only the web app knows.

## Consequences

- A new role is flavoured on home the moment its grants exist. No web change.
- An actor with two roles gets the union, which is the right answer and the one
  a table cannot express.
- Panel *order* is fixed for everyone. If ordering per role is ever wanted it
  needs its own decision — sorting by "what this actor opened last" is the
  variant to consider first, because it is still derived rather than declared.
- Areas the actor cannot open are still counted and now still named
  (`moduleName`), so the panel reports the business rather than the role.
