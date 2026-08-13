# 06 — Test scripts

Two halves:

- **Part A — manual UAT scripts.** Numbered, step-by-step, executable by a
  human against staging with the demo accounts. Every script has explicit
  *expected* lines and a pass/fail column.
- **Part B — automated suite map.** What suites exist, what each spec covers,
  how to run them, where reports land, and the flaky-test policy.

Companion document: [`05-use-cases.md`](./05-use-cases.md) has the business
context for each flow (actors, what gets written, why the gates exist). This
document is the mechanics.

---

## Part A — Manual UAT scripts

### A.0 Before you start

**Environments**

| Environment | Web | API |
| --- | --- | --- |
| Local | `http://127.0.0.1:5173` | `http://127.0.0.1:8797` |
| Staging | `https://staging.lyra.vantax.co.za` | `https://api-staging.lyra.vantax.co.za` |
| Live | `https://lyra.vantax.co.za` | — |

Local ports and paths are defined in [`e2e/env.ts`](../../e2e/env.ts); staging
origins in [`e2e/sim/env.ts`](../../e2e/sim/env.ts); the live default in
[`playwright.live.config.ts`](../../playwright.live.config.ts).

**Accounts.** Tenant slug `gonxt`, password `Gonxt-Demo-2026!` for every demo
persona. The login screen has a **"Demo sign-in"** disclosure with a one-click
button per persona. Full persona table: [`05-use-cases.md`](./05-use-cases.md)
§2.2. These are seeded demo fixtures — never real credentials, and they must
never exist on a production tenant.

**Rules for the tester**

1. **Sign out between personas.** Half of these scripts prove that role B
   cannot do what role A can. A stale session invalidates the result.
2. **A refusal is usually a pass.** "Waiting on an approval" and "Your roles do
   not include access to this area." are the product working. Only mark FAIL if
   the *wrong* thing happened.
3. **Approval does not replay the action.** After approving, go back and
   **re-submit** the original edit. Nothing writes itself.
4. **Record the reference.** Note the id, claim number or short ref of anything
   you create — the audit-log checks at the end of each script need it.
5. **Use a private window for portal scripts.** They must work with no session.

**Reset.** Local runs reset via `pnpm e2e` (see Part B §B.3). Staging **is not
reset** between runs — the simulation deliberately persists across virtual
days. Assume the data you create stays.

---

### UAT-01 — Sign-in, MFA, and role landing

Covers: authentication, per-role home, the permission wall.
Personas: several. Time: ~10 min.

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 1 | Open `/login` in a private window. | Sign-in form with **Email**, **Password**, **Continue**. An organisation/tenant field may be present. | |
| 2 | Sign in as `amina.saleh@gonxt.ae` / `Gonxt-Demo-2026!` (tenant `gonxt`). | If MFA enrolment is due: a setup key of 16+ uppercase-and-digit characters, a **Confirm** step and recovery codes with **"I have saved them"**. Otherwise straight through. | |
| 3 | Observe the landing URL. | Lands on `/admin`. Primary nav contains a link named **Administration**. | |
| 4 | Sign out. Use the **Demo sign-in** disclosure to sign in as **Layla Hassan**. | Lands on `/axis`. | |
| 5 | Repeat for Sara Al Nasser, Noor Jamal, Tariq Mansour, Hala Zayed. | `/orbit`, `/signal`, `/scout`, `/north` respectively. | |
| 6 | As Layla Hassan (`axis.agent`), type `/signal/campaigns` into the address bar. | The screen reads **"Your roles do not include access to this area."** — not a 404, not an empty list, not a disabled button. | |
| 7 | Press **⌘K** (Ctrl+K on Windows). | The command palette opens, offering the same destinations as the module rail. Selecting one navigates there. | |
| 8 | Sign in as **Khalid Al Rashed** (`tenant.compliance`). | The entire workspace renders in Arabic, right-to-left. This is correct — his seeded locale is `ar`. | |

Automated equivalent: [`e2e/login.spec.ts`](../../e2e/login.spec.ts),
[`e2e/horizon-shell.spec.ts`](../../e2e/horizon-shell.spec.ts).

---

### UAT-02 — Quote to policy, end to end

Covers: the public self-serve quote (J-C1) and the desk-side bind gate.
Personas: none (public), then Omar Farouk (`axis.lead`), then a second
approver. Time: ~20 min.

**Part 1 — the customer's path (no session)**

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 1 | Private window. Open `/portal/gonxt`. | The tenant storefront renders with the tenant's own brand — product name, logo, accent colour. The word "LYRA" appears nowhere. | |
| 2 | Find the **Motor comprehensive** product region and click **"Get a quote"**. | A short form: **Your age**, **Value to insure**, **Full name**, **Email**, and a consent checkbox. | |
| 3 | Fill age `34`, value `280000`, a name, an email. Leave the consent box **unticked** and press **"Request quote"**. | It does not submit. Consent is required, not optional. | |
| 4 | Tick **"I agree to be contacted about this quote."** and press **"Request quote"**. | Redirects to `/portal/gonxt/quotes/<id>?token=<token>`, heading **"Your quotes"**. | |
| 5 | Read the offer list. | States **"Ranked by total price, cheapest first."** with a **Cheapest** marker on the top offer. | |
| 6 | Search the page for the words *commission*, *value score*, *declined because*. | **None of them appear.** Internal ranking signals are never public. FAIL if any is visible. | |
| 7 | Press **"Choose this cover"** on an offer. | Heading **"Next: send your documents"**, the text **"Nothing is bound yet."**, and the offer marked **Chosen**. | |
| 8 | Attach any small file to the **Document** input and press **"Upload document"**. | **"Received. Upload another if you have one."** | |
| 9 | Copy the URL, strip `?token=…`, and open it in a fresh private window. | The quotes do **not** render. Without the one-time token the page is unreachable. FAIL if the quotes load. | |
| 10 | Note the quote id. | — | |

**Part 2 — the desk binds it**

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 11 | Sign in as **Omar Farouk** (`axis.lead`). Open `/axis/policies`. | The policy list renders. | |
| 12 | Open **New**, create a policy with a premium **above** 250,000.00 in minor units (e.g. `40000000`). | Refused. An alert names **`axis.bind`**, and the policy is **not** in the list. | |
| 13 | Search the list for the policy you just tried to create. | Absent. A gated action writes nothing at all — not a draft, not a pending row. | |
| 14 | Open `/approvals`. | A pending request for `axis.bind` naming your subject. | |
| 15 | Sign in as a **different** person who may decide it, and approve. | **"Approved. The action may now proceed."** | |
| 16 | Sign back in as Omar Farouk, re-enter the same policy details, **Create**. | The policy is created and appears in the list. | |
| 17 | Open `/admin/audit-log` as **Amina Saleh**. | Entries for the approval decision and the policy write, each naming its actor. | |

Automated equivalent: [`e2e/self-serve-quote.spec.ts`](../../e2e/self-serve-quote.spec.ts),
[`e2e/save-desk.spec.ts`](../../e2e/save-desk.spec.ts).

---

### UAT-03 — Claim: FNOL to settlement

Covers: intake, coverage check, desk triage, reserve, payment request.
Personas: Layla Hassan (`axis.agent`), Omar Farouk (`axis.lead`), two finance
controllers. Time: ~25 min.

**Part 1 — first notice of loss**

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 1 | Sign in as **Layla Hassan**. Open `/axis/claims/new`. | Heading **"New claim (FNOL)"**. | |
| 2 | Select an in-force policy. Fill **Date of loss** (a date inside the policy term), **Peril** = Collision, **Cause**, **What happened**, **Estimated amount**, **Contact**, **Reported via** = WhatsApp. | Fields accept the values. | |
| 3 | Press **"Check cover"** *before* registering. | A coverage panel states the position at the date of loss: **In force**. | |
| 4 | Change **Date of loss** to a date **before** the policy incepted and press **"Check cover"** again. | The panel reads **Not yet incepted** (or **Out of cover**) and the screen offers **"Register anyway, flag for review"**. FAIL if it silently blocks with no explanation, or silently accepts. | |
| 5 | Restore the valid date, press **"Check cover"**, then **"Register claim"**. | **"Claim {claimNo} registered."** Note the claim number. | |

**Part 2 — the desk**

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 6 | Open `/axis/claims/desk`. | Heading **"Claims desk"**. Columns: Claim, Claimant, Peril, Incurred, Reserve, Days open, Fraud score, Handler. State counts across Reported → Closed. | |
| 7 | Find your claim. Check its **Fraud score** column. | A score is present, and hovering/opening it shows the indicators behind it. A score with no stated reason is a FAIL (the `axis-fraud` eval forbids unexplained indicators). | |
| 8 | Use the **"Assign a handler"** panel: pick your Claim, pick a Handler, press **Assign**. | **"Handler updated."** and the Handler column changes. | |
| 9 | Use the **Advance** panel: pick an **Outcome** and a **Reason code**, press **Advance**. | The claim moves state. A move with no reason code is refused. | |

**Part 3 — reserve and payment**

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 10 | Open `/axis/claims/<id>/detail`. | Sections: **First notice**, **The claim**, **Reserve**, **Move the claim**, **Payment**, **Cover at the loss**. | |
| 11 | Confirm **First notice** matches what you typed at step 2. | Unedited. The original report is never overwritten by later assessment. | |
| 12 | In **Reserve**, set **Reserve after this movement** and a **Basis**, press **"Add the reserve"**. | **"The reserve was added."** | |
| 13 | In **Payment**, fill **Paid to**, **Payee**, **Amount**, **Method**. Press **"Request the payment"**. | **"The payment was requested."** — *requested*, not paid. | |
| 14 | Sign in as a **finance controller** and open `/approvals`. | The payment awaits a decision. | |
| 15 | Approve it, then check the ledger for the movement. | The reserve movement and the payment appear as **balanced** journal lines (debits equal credits). FAIL on any unbalanced batch. | |

Automated equivalent: API and route unit tests only —
`apps/api/src/axis-fnol.test.ts`, `axis-claim-reserve.test.ts`,
`axis-claim-payment.test.ts` and the matching
`apps/web/app/routes/*.test.ts`. **There is no e2e spec for the claim
lifecycle**, which makes this script the primary regression check for claims
before a release.

---

### UAT-04 — An action that requires human sign-off

Covers: the approval engine — single control, dual control, and
`neverAutoApprove`. Personas: Tariq Mansour (`scout.lead`), Amina Saleh
(`tenant.admin`), two finance controllers. Time: ~20 min.

**Part 1 — single control (the requester may decide)**

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 1 | Sign in as **Tariq Mansour**. Open `/scout/whitespaces`. | The list renders. Note: there is no search box; `?q=` returns a 400. | |
| 2 | Open the **Domestic helper package** row. | The record opens. | |
| 3 | Set **Status** = Validated, fill **Owner** = `tariq.mansour`, fill **Promoted** with a datetime. **Save changes**. | Refused: **"Waiting on an approval"** naming **`scout.whitespace_promote`**, plus a link **"Open the approval queue"**. | |
| 4 | Note the **Status** select's options. | `candidate`, `validating`, `validated`, `parked`. **`promoted` is not offered** — known limit, not a bug. | |
| 5 | Follow the link to `/approvals`. Find the **Whitespace promote** region and press **Approve**. | **"Approved. The action may now proceed."** The same person may decide this one — it is single control. | |
| 6 | Return to the record and **re-enter the same three fields**, **Save changes**. | Now it writes. Reopening shows Validated and the owner. | |
| 7 | Note whether step 5 alone changed the record. | It did **not**. Approving authorises; it does not replay. | |

**Part 2 — dual control (a second human is mandatory)**

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 8 | Sign in as **Amina Saleh**. Open `/distribution/commission-rates`, **New**, fill **Channel**, **Channel share** = `500000`, **Effective from** = a future date. **Create**. | Refused, alert names **`dist.rate_change`**. The rate is **not** in the list. | |
| 9 | As **Amina Saleh**, open `/approvals` and try to approve your own request. | You cannot. `dist.rate_change` is dual control — the requester may never decide it. FAIL if you can. | |
| 10 | Sign in as **Nadia Rahman** (`finance.controller`). Open `/approvals`, find **Dist rate change**, press **Approve**. | **"Approved. The action may now proceed."** | |
| 11 | Sign in as **Faisal Omar**. Open `/ledger/settlement`, open a **Draft** run, press **Approve**. | **"Waiting on an approval"** naming **`dist.settlement_run`** with an **"Open the approval queue"** link — regardless of the amount. `dist.settlement_run` is `always` + `neverAutoApprove`. | |
| 12 | As **Nadia Rahman**, decide it on `/approvals`. | Approved by a second controller. | |
| 13 | Open `/admin/audit-log`. | Every request and every decision is logged with its actor and timestamp. | |

Automated equivalent: [`e2e/scout-whitespace.spec.ts`](../../e2e/scout-whitespace.spec.ts),
[`e2e/panel-negotiation.spec.ts`](../../e2e/panel-negotiation.spec.ts),
[`e2e/save-desk.spec.ts`](../../e2e/save-desk.spec.ts),
[`e2e/signal-budget.spec.ts`](../../e2e/signal-budget.spec.ts).

---

### UAT-05 — Ledger posting, reconciliation and period close

Covers: transaction open, recon with reasons, soft/hard close, drift check,
year end. Persona: Nadia Rahman (`finance.controller`). Time: ~25 min.

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 1 | Sign in as **Nadia Rahman**. Open `/ledger/transactions`. | The transaction list renders. | |
| 2 | Open a transaction: fill **Transaction key** (a unique idempotency key), **Currency** = `AED`, **Gross amount** = `5000`, **Amount** = `5000`, press **"Open transaction"**. | **"Opened as …"** Note the reference. | |
| 3 | Repeat step 2 with the **same Transaction key**. | It does **not** create a second transaction. Idempotency keys are the double-post guard. FAIL if a duplicate appears. | |
| 4 | Open `/ledger/reports/trial-balance`. | Total debits equal total credits. Any imbalance is Sev-1. | |
| 5 | Open `/ledger/recon`. Paste statement lines into **"Statement lines*"** and press **"Start run"**. | A run is created. | |
| 6 | Open the run. | Proposed matches, each marked **Within tolerance** / **Proposed**. | |
| 7 | On a matched row, press **Confirm** with the **Why** field left empty. | Refused. The reason is mandatory — it is the audit evidence. | |
| 8 | Fill **Why** = "Matches bank feed for this period" and press **Confirm**. | **"Match recorded as Confirmed"** and the row reads **Confirmed**. | |
| 9 | Open `/ledger/period-close` and enter a period code in `YYYY-MM` form (e.g. `2026-07`). | The period's checks table renders, each check **OK** or **Fail** with a detail column. | |
| 10 | If any check reads **Fail**, try to close. | Blocked. A failing check stops the close — that is the point of the table. | |
| 11 | Press **Soft close**. | Confirmation: *"Soft close this period? Ordinary posting stops; adjustments with a reason still post."* Confirm it. | |
| 12 | Try to post an ordinary journal into the soft-closed period via `/ledger/journal`. | Refused. An adjustment **with a reason** still posts. | |
| 13 | Press **Hard close**. | Confirmation: *"Hard close this period? Only contra entries post afterwards."* Confirm it. | |
| 14 | Try any ordinary posting into the hard-closed period. | Refused. Only contra entries post. | |
| 15 | Press **"Run the check"** (the rebuild). | Balances are rebuilt from the journal and compared to stored. **The drift table should be empty.** Any drift row means stored balances disagree with the journal — Sev-1 finance issue, not a display bug. | |
| 16 | Open `/ledger/year-end` and preview. | The closing entry into **Retained Earnings (account 3100)** is previewed **before** posting. | |
| 17 | Check the recent-periods table on `/ledger/period-close`. | Records who closed each period and when. **Reopen** is available and is itself confirmed and logged. | |

Automated equivalent: `apps/api/src/ledger.test.ts`,
`apps/api/src/ledger-journals.test.ts`,
`apps/web/app/routes/ledger.shared.test.ts`, and — read-only against the
deployed site — [`e2e/live/ledger-history.spec.ts`](../../e2e/live/ledger-history.spec.ts).
**Period close has no dedicated e2e spec**; this script is the release check.

---

### UAT-06 — SIGNAL: campaign launch and budget reversal

Covers: J-M1 and J-M2. Persona: Noor Jamal (`signal.lead`). Time: ~15 min.

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 1 | Sign in as **Noor Jamal**. Open `/signal/audiences`, **New**, fill **Name** and **Definition** (JSON rule tree), **Create**. | The audience is created. Open it and note the id from the URL. | |
| 2 | Open `/signal/campaigns`, **New**. Fill **Name**, **Audience** = that id, **Channels** = `["email","whatsapp"]`, **Budget** = `{"dailyMinor":50000}`, **Owner** = `noor.jamal@gonxt.ae`. **Create**. | Created. | |
| 3 | Open the campaign. | It reads **Draft**. | |
| 4 | Set the state to **Live** and **Save changes**. | It goes **Live** with **no approval interruption** — `signal.campaign_launch` is on the tenant's `auto_approve` allowlist. | |
| 5 | Open `/admin/audit-log` and search for the campaign's short reference. | A `signal.campaigns.update` entry naming the campaign. Auto-approved is **not** unlogged. FAIL if absent. | |
| 6 | Sign in as a persona **without** the launch permission (e.g. Layla Hassan) and open `/signal/campaigns`. | **"Your roles do not include access to this area."** | |
| 7 | Back as Noor Jamal, open `/signal/budget-moves` and open the **"Bing's cost per policy"** row. Note the id. | The move record opens. | |
| 8 | Fill **Reversed by** = `noor.jamal@gonxt.ae` and **Reversed** = a datetime. **Save changes**. | Refused: **"Waiting on an approval"** naming **`signal.budget_move`**. | |
| 9 | Open `/approvals`, find the **Budget move** region for that id, press **Approve**. | Approved. Single control — the same lead may decide, which is what makes the two-minute mobile flow possible. | |
| 10 | Return to the record, **re-enter** both fields, **Save changes**. Reload. | The reversal persists. | |
| 11 | Open `/signal/aeo-pages`, **New**, fill **Query cluster** and **Content**, **Create**. Open the record. | It reads **Draft** against the query cluster it was authored for. | |
| 12 | Open `/signal/budget` and check the autopilot bounds; open `/signal/cockpit`. | The spend ceiling and the autopilot's bounds are visible and there is a global pause. | |

Automated equivalent: [`e2e/campaign.spec.ts`](../../e2e/campaign.spec.ts),
[`e2e/signal-budget.spec.ts`](../../e2e/signal-budget.spec.ts),
[`e2e/answer-box.spec.ts`](../../e2e/answer-box.spec.ts).

---

### UAT-07 — ORBIT: conversation, AI draft approval, handover, save desk

Covers: J-C2, J-X1, and the save desk. Personas: Sara Al Nasser
(`orbit.agent`), Yusuf Karim (`orbit.retention`). Time: ~20 min.

**Part 1 — the AI drafts, the human decides**

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 1 | Sign in as **Sara Al Nasser**. Open `/orbit/conversations`, **New**, **Channel** = WhatsApp, **Customer** = any reference. **Create**. | Created. Open the row and note the conversation id from the URL. | |
| 2 | Open `/orbit/messages`, **New**: **Conversation** = that id, **Sender** = Customer, **Message** = a question. **Create**. | The row appears. **Message content shows as `[redacted]`** in the list — PII masking without `core:pii:view`. That is correct. | |
| 3 | Add a second message on the same conversation: **Sender** = AI agent, **Message** = a drafted reply. | Two rows for that conversation. | |
| 4 | Open `/orbit/conversations/<id>/thread`. | A region **"Suggested reply"** holds the draft, marked with the single **✦** AI marker and an inspectable "why". No modal appears. | |
| 5 | Press **"Approve and queue"**. | Status reads exactly: **"Draft approved and queued as an AI turn. It has not left yet."** FAIL if it says "sent". | |
| 6 | Confirm nothing left the system before step 5. | Nothing auto-sends outside the tenant's autonomy policy. | |

**Part 2 — handover**

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 7 | Open `/orbit/conversations` and open the seeded row `wa:971559876543`. Click **"Open thread"**. | A region **"Handover notes"** shows the AI's escalation summary, and a region **"Quality scores"** shows the QA scores. | |
| 8 | On your own conversation from Part 1, fill **"What the next person needs to know"** and press **"Save handover note"**. | The note appears under Handover notes immediately. | |
| 9 | As Sara (`orbit.agent`), try to score the conversation. | You cannot — scoring needs `orbit:qa:score`, which the agent does not hold. | |
| 10 | Sign in as an `orbit.lead` and open `/orbit/qa-scores`. | `orbit.escalation` scores are listed. Scoring the handover is the lead's job. | |

**Part 3 — save desk**

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 11 | Sign in as **Yusuf Karim**. Open `/orbit/save`. | Heading **"Save desk"**. Tiles: **High churn risk**, **Waiting on us**, **Offer out**, **Saved this window**. Sections: **Save queue**, **Offers outstanding**, **Recently settled**. | |
| 12 | On a queue row, click **"Why this score"**. | The churn-risk drivers are shown. A score with no explanation is a FAIL. | |
| 13 | Press **"Make the offer"** and send a save offer. | The row moves to **Offers outstanding**. | |
| 14 | Press **"Record the outcome"**, choose a **Result** (e.g. *Saved with a discount*) and a **Reason**. | **"Recorded."** and the row moves to **Recently settled**. | |
| 15 | Press **"Change strategy"** on another row. | The strategy is reassigned and recorded. | |

Automated equivalent: [`e2e/orbit-journeys.spec.ts`](../../e2e/orbit-journeys.spec.ts),
[`e2e/handover.spec.ts`](../../e2e/handover.spec.ts). **`/orbit/save` has no
e2e spec** — Part 3 is the only regression check for the save desk.

---

### UAT-08 — Tenant onboarding, staff and branding

Covers: J-A1, J-A2, and the brand-token rule. Persona: Amina Saleh
(`tenant.admin`). Time: ~15 min.

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 1 | Sign in as **Amina Saleh**. Open `/admin/roles`. | More than ten roles are provisioned. | |
| 2 | Open `/admin/agents`. | At least eight agents are provisioned. | |
| 3 | Open `/admin/tenants`. | **Exactly one row**: your own tenant, `gonxt`, plan **enterprise**. FAIL immediately if any other tenant is visible — that is a tenancy breach. | |
| 4 | Open the tenant row. | Heading **GONXT**; the slug `gonxt` in a read-only detail list; a **Brand** field holding the brand JSON. | |
| 5 | Open `/admin/staff`. Fill **Email**, **Name** = "Priya Nair", tick **Tenant administrator**, press **"Send invitation"**. | An **Invited** heading, and the person in the staff table with status **Invited**. | |
| 6 | Open `/admin/permissions`. | The per-role permission grid is inspectable. | |
| 7 | Open `/settings/brand`. | The **Tenant appearance** panel: **Product name**, **Logo for light backgrounds**, **Logo for dark backgrounds**, **Square mark**, **Accent**, **Accent, hovered**, **Text on the accent**, **Typeface**, and a live **Preview** with a **Primary action** button. | |
| 8 | Set **Accent** and **Text on the accent** to two colours with poor contrast (e.g. `#FFFF00` on `#FFFFFF`) and save. | **Refused with a contrast message.** The brand cannot be saved below the contrast floor. FAIL if it saves. | |
| 9 | Set a valid accent and a **Product name**, then save. | **"Appearance saved. It applies on the next screen you open."** | |
| 10 | Navigate to another screen. | The new product name and accent are in effect. | |
| 11 | Walk three screens looking for the literal string "LYRA" in user-facing copy. | It appears nowhere. All naming comes from tenant config. A hard-coded "LYRA" is a bug. | |
| 12 | Open `/portal/gonxt` in a private window. | The public storefront carries the same tenant brand. | |

Automated equivalent: [`e2e/tenant-onboarding.spec.ts`](../../e2e/tenant-onboarding.spec.ts),
[`e2e/staff.spec.ts`](../../e2e/staff.spec.ts),
`apps/web/app/routes/settings-brand.test.ts`.

**Known scope gap.** There is **no tenant-creation form** and no
`platform.admin` demo persona. Creating a tenant is an operational task, not a
UI journey. Do not raise it as a defect — see
[`05-use-cases.md`](./05-use-cases.md) UC-17.

---

### UAT-09 — Accessibility spot-check

Covers: WCAG 2.2 AA on the screens the automated axe run does not reach.
Persona: any. Time: ~15 min. Tools: keyboard only, then browser zoom.

Run this on at least four screens, chosen to span the surface: `/login`, a
dense list (`/axis/cases`), a form (`/axis/claims/new`), and the public portal
(`/portal/gonxt`).

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 1 | Put the mouse away. Load the screen and press **Tab** repeatedly. | Every interactive element is reachable in a sensible order. Nothing is skipped; nothing is a trap. | |
| 2 | Watch the focus indicator at each stop. | Focus is **always visibly** indicated. An invisible focus ring is a FAIL. | |
| 3 | Open a Radix select (e.g. **Peril**) with the keyboard: Tab to it, then type the first letters of an option. | Typeahead selects the option. The dropdown is fully operable without a mouse. | |
| 4 | Submit a form with a deliberate error using only the keyboard. | The error is announced and focus moves to something useful — not lost at the top of the document. | |
| 5 | Zoom the browser to **200%**. | No content is lost or clipped; nothing requires horizontal scrolling to read. | |
| 6 | Check body-text contrast with a browser contrast tool. | ≥ 4.5:1 for body text. | |
| 7 | Trigger a status message (any save). | It is in a `role="status"` region so a screen reader announces it. | |
| 8 | Check the primary nav's accessible name. | Named **Primary** (English) or **التنقل الرئيسي** (Arabic). | |
| 9 | Check `prefers-reduced-motion`. | With reduced motion on, animation is suppressed. The Playwright suite runs with `reducedMotion: "reduce"` for exactly this reason. | |

Automated equivalent: [`e2e/a11y.ts`](../../e2e/a11y.ts) runs axe-core with
tags `wcag2a`, `wcag2aa`, `wcag22aa` and asserts **zero** violations. It is
called from [`e2e/login.spec.ts`](../../e2e/login.spec.ts),
[`e2e/staff.spec.ts`](../../e2e/staff.spec.ts) and
[`e2e/live/smoke.spec.ts`](../../e2e/live/smoke.spec.ts). Axe catches machine-
detectable failures only — steps 1–5 above are what it **cannot** catch, which
is why this script exists.

---

### UAT-10 — Arabic and RTL spot-check

Covers: i18n completeness and right-to-left layout. Persona: Khalid Al Rashed
(`tenant.compliance`, locale `ar`). Time: ~15 min.

| # | Step | Expected | P/F |
| --- | --- | --- | --- |
| 1 | Sign in as **Khalid Al Rashed**. | The entire workspace renders in Arabic, right-to-left, from the first paint. | |
| 2 | Check the page direction and the nav position. | `dir="rtl"`; the module rail is mirrored to the right-hand side. Layout must use logical properties, so nothing sits on the wrong edge. | |
| 3 | Scan every visible label for raw i18n keys — strings like `nav.axis`, `period.closeSoft`, or camelCase identifiers where a sentence should be. | **None.** A raw key on screen is a missing translation and a FAIL. | |
| 4 | Open `/compliance/run/evidence`. | Heading **عمليات الامتثال**. Fields **الموضوع** (subject) and **أُعدّت لصالح** (prepared for). Button **إنشاء الحزمة**. | |
| 5 | Fill the subject (e.g. `customer-91827`) and the recipient, press **إنشاء الحزمة**. | A **الحزمة** section appears reading **جاهزة** with a **تنزيل الحزمة** download link. | |
| 6 | Download the bundle. | It downloads and is signed. | |
| 7 | Open `/admin/ai/console`. | The **الإحاطة التنفيذية** (Executive briefing) agent card reads **نشط** (active). | |
| 8 | Fill **السبب** (reason) and press **إيقاف الوكيل** (pause). | The card reads **موقوف** (paused). Leaving the reason empty must be refused. | |
| 9 | In a **second browser**, signed in as **Amina Saleh**, watch `/admin/ai/console`. | The same agent flips to **Paused** without her doing anything. Cross-session visibility is the point of a kill switch. | |
| 10 | As Amina, press **"Resume agent"**. | The card returns to **Active**. Note: the resume has **no** note field — known limit. | |
| 11 | Check numbers, dates and currency in the Arabic UI. | Formatted for the locale, not left in the English format. | |
| 12 | Check a dense list screen (e.g. `/admin/customers`) in Arabic. | Table columns, sort arrows and pagination all mirror correctly; nothing overflows. | |
| 13 | Compare an Arabic screen with its English equivalent. | Every English affordance has an Arabic one. No untranslated fallbacks. | |

Automated equivalent: [`e2e/compliance.spec.ts`](../../e2e/compliance.spec.ts)
and [`e2e/ai-console.spec.ts`](../../e2e/ai-console.spec.ts) both drive Arabic
UI; [`e2e/pseudo-locale.spec.ts`](../../e2e/pseudo-locale.spec.ts) proves
layout survives string expansion and renders `/login` plus the dense workspace
screens in Arabic.

---

### UAT-11 — Regression sweep for the remaining journeys

The scripts above cover the ten required flows. These shorter checks close the
gap to all 23 journeys. Run before a release.

| # | Journey | Check | Expected | P/F |
| --- | --- | --- | --- | --- |
| 1 | J-O1 | As Layla Hassan: create a case on `/axis/cases`, set it **Failed**, confirm it appears in `/axis/cases?status=failed`, set it back to **Quoting**, reload the filter. | The case **disappears** from the failed queue. | |
| 2 | J-O2 | As Omar Farouk: create a quote request on `/distribution/quote-requests` (Channel `alpha-brokers`, a `health` product), then open `/distribution/quote-requests/<id>/compare`. | **"The panel was never asked"** and **"This request has no responses at all, not even a decline. Re-shop it to send the requirement out."** — not a blank screen implying declines. | |
| 3 | J-C3 | As Yusuf Karim: open `/orbit/renewals`, open a renewal, then `/distribution/next-best-offers/suggest?customerId=<id>`, press **"Propose offers"**. | The **"Surface … to the customer"** button is **absent** — retention lacks `dist:offers:surface`. As Omar Farouk on the same URL, it is **present** and yields **"Surfaced."** | |
| 4 | J-X3 | `POST /v1/onboarding/partners/signup`; call `GET /v1/dist/quote-requests` and `GET /v1/core/users` with the returned key; repeat the signup from the same email. | Quote requests allowed, users **denied**, duplicate signup **throttled**. | |
| 5 | J-M3 | `/signal/aeo-pages` — covered in UAT-06 steps 11. | Draft page against a query cluster. | |
| 6 | J-P2 | `/scout/panel-bench` as Tariq Mansour. | Benchmark rows by line (e.g. `motor`) with win rate and price index versus panel median. | |
| 7 | J-E1 | As Hala Zayed **in a phone-sized viewport**: `/north/briefings` — open yesterday's *Executive / en* row; then `/north/anomalies` — open `cac_per_policy`, set **Linked action**, **Save changes**. | Briefing reads **Published** and renders as prose with numbers first; the anomaly shows **Action created**. | |
| 8 | J-E2 | `/north/boardpacks` — **New** with **Title**, **Period** `2026-Q1`, **Sections**. | The pack is assembled in one action. Approve/distribute/read-receipts do **not** exist — known scope gap, not a defect. | |
| 9 | J-E3 | `/north/scenarios` — create with **Question**, **Assumptions**, **Author**; later edit Assumptions to add actuals. | The scenario returns with updated assumptions intact. Ranges shown, never a single confident number. | |
| 10 | J-D1 | `GET /openapi.json` (public, 200), `GET /health` (200), `GET /v1/me` with no token (**401**) and with a bad token (**401**). Then `/settings/security`: **"What is it for"** → **Issue key** → secret starts `qvk_test_` → call `/v1/me` with it → **Revoke**. | Key row reads **Test / Active**, then **"That key has been revoked."**, row **Revoked**, **Revoke** button gone, and the API rejects the key. | |
| 11 | J-C4 | Private window: `/portal/gonxt` → **"Your privacy rights"** → **"Delete my data"** → an email → **"Send request"**. Repeat with an address that is definitely not a customer. | **Both** show **"Request received"** with a reference starting `dsr_`. Neither says *not found*, *no record* or *unknown*. Any difference between the two responses is a data leak and a FAIL. | |
| 12 | Endorsement | As Omar Farouk on `/axis/policies/<id>/detail` → **Endorse** → **Changes (JSON)** → **"Price this change"** → tick the confirm box → **"Confirm the endorsement"**. | **Pro-rata days** and the money effect are shown **before** the confirm box can be ticked. Heading **"Endorsement written"**. | |
| 13 | Cancellation | Same policy → **Cancel** → **"Price this cancellation"** → **Refund** and **Commission clawback** shown → confirm. | **"This cancellation needs an approval first"** — money out never writes on one person's say-so. | |
| 14 | Renewal desk | `/axis/renewals`: **"Auto re-quote"**, **"Do not contact"**, then **"Bind renewal"**. | The first two read **"Recorded."**; binding reads **"Waiting on an approval"**. | |

---

## Part B — Automated suite map

### B.1 The suites at a glance

| Suite | Runner | Command | What it proves |
| --- | --- | --- | --- |
| Unit | vitest (workers pool) | `pnpm test` | Domain logic, route loaders/actions, schema, gateway. Target under 60s. |
| Integration | vitest + miniflare bindings | `pnpm test` (same run) | Real D1/KV/R2/Queue bindings; the route×role authz matrix. |
| Contract | vitest | `pnpm test` (in `packages/sdk`) | OpenAPI conformance, event envelopes, webhook signatures, SDK pacts. |
| E2E (local) | Playwright | `pnpm e2e` | The journey catalogue — every J-ID has ≥ 1 spec. |
| E2E (live) | Playwright | `pnpm e2e:live` | Read-only smoke over the deployed site. |
| Simulation | Playwright | `pnpm e2e:sim` | 30 virtual days of staging usage. |
| Evals | tsx | `pnpm eval` | Model behaviour against golden sets and thresholds. |
| Mutation | Stryker | `pnpm mutation` | That the tests actually assert. Gate: score ≥ 70. |
| Lint / types | eslint, tsc | `pnpm lint`, `pnpm typecheck` | — |
| Everything | — | `pnpm check` | `lint && typecheck && test` |

Testing strategy in full: [`docs/13-testing-quality.md`](../13-testing-quality.md).

### B.2 Unit and integration

```
pnpm test                                    # every package, via turbo
pnpm test:watch                              # vitest watch
pnpm --filter @lyra/core test                # one package
pnpm --filter @lyra/api test -- axis-fnol    # one file by name filter
pnpm test:cli                                # the scripts/ suite
```

Rough distribution of test files:

| Package | Test files | Notable |
| --- | --- | --- |
| `apps/api` | 82 | `journeys.test.ts` is the acceptance suite (`@accept:Mx`); `ledger*.test.ts`, `settlement.test.ts`, `axis-*.test.ts`, `compliance.test.ts`, `portal.test.ts`, `mfa.test.ts`, `api-keys.test.ts`, `partner-signup.test.ts`. |
| `apps/web` | 80 | One per route: `approvals`, `claim-detail`, `claims-desk`, `fnol-intake`, `policy-endorse`, `policy-cancel`, `renewal-desk`, `settlement`, `settings-brand`, `ledger.shared`, `ledger-money-map`, `labels.shared`, `module.denied`. |
| `packages/core` | 35 | Tenancy, RBAC, approvals, ledger invariants (property-tested). |
| `packages/model-gateway` | 10 | Provider abstraction, audit-log emission, routing. |
| `packages/ui` | 10 | Constellation components. |
| `packages/db` | 6 | Schema and migration shape. |
| `packages/sdk` | 1 | The contract suite (see B.6). |
| `apps/mobile` | 1 | — |
| `scripts` | 2 | The `lyra` CLI. |
| `packages/agents` | 0 | Covered through `apps/api`. |

### B.3 End-to-end (local)

```
pnpm e2e
```

That script is `tsx e2e/global-setup.ts && playwright test`. Two things matter:

1. **[`e2e/global-setup.ts`](../../e2e/global-setup.ts) is run by the npm
   script, not by Playwright's `globalSetup`.** Running `playwright test`
   directly skips it, and specs will fail on missing fixtures.
2. It **only wipes, migrates and seeds when the database file is absent**. On a
   subsequent run it instead resets the handful of fixtures the specs mutate:
   Amina Saleh's MFA, the seeded `signal_budget_moves` reversal and its
   approval, surfaced `dist_next_best_offers` back to `proposed`, and the
   system role permissions. To force a clean slate, delete the database at
   `$TMPDIR/lyra-e2e/e2e.db`.

Config: [`playwright.config.ts`](../../playwright.config.ts) — testDir `./e2e`,
`testIgnore: "live/**"`, fully parallel, 2 workers, 120s test timeout, 15s
expect timeout, 1 retry on CI and 0 locally, chromium only, `trace:
"retain-on-failure"`, `reducedMotion: "reduce"`. It starts two web servers
itself: the API (`pnpm --filter @lyra/api start`) and the web app
(`pnpm --filter @lyra/web dev`).

**Running a subset**

```
pnpm e2e -- e2e/campaign.spec.ts                    # one file
pnpm e2e -- -g "J-M1"                               # by journey tag
pnpm e2e -- -g "@accept:M4"                         # by acceptance tag
pnpm e2e -- --headed --workers=1                    # watch it happen
pnpm e2e -- --debug e2e/save-desk.spec.ts           # inspector
npx playwright show-trace test-results/<...>/trace.zip
```

Journey tags are literal text in the test title, so `-g` matches them directly.

**Shared helpers**

| File | Provides |
| --- | --- |
| [`e2e/env.ts`](../../e2e/env.ts) | Ports, origins, DB path, tenant slug, the demo password, the 11 `PERSONAS`. |
| [`e2e/fixtures.ts`](../../e2e/fixtures.ts) | `goto()` (waits for `__reactRouterDataRouter` before acting — React Router v7 hydration gate), `loginAs*` per persona, `confirmAction()`, `content()` (scopes to `<main>`), `shortRef()`, `chooseOption()` (Radix Select keyboard typeahead with 3 retries). |
| [`e2e/a11y.ts`](../../e2e/a11y.ts) | `expectNoA11yViolations(page)` — axe tags `wcag2a`, `wcag2aa`, `wcag22aa`, asserts `violations` equals `[]`. |
| [`e2e/global-setup.ts`](../../e2e/global-setup.ts) | Seed and per-run fixture reset. |

**Two constraints that explain most spec oddities.** Playwright's
`page.request` cannot authenticate against the API origin — the web app
forwards the browser's cookie header server-side, so a direct API-origin
request 401s. Specs therefore drive the real UI panels, or reach past them with
direct DB access (the `runRenewalsSweep()` helper in
[`e2e/orbit-journeys.spec.ts`](../../e2e/orbit-journeys.spec.ts) calls
`sweepRenewals` against the e2e database, because a renewal has no create
permission and no UI trigger).

### B.4 Spec inventory

Every spec under [`e2e/`](../../e2e), what it covers, and its tags.

| Spec | Covers | Tags |
| --- | --- | --- |
| [`ai-console.spec.ts`](../../e2e/ai-console.spec.ts) | Compliance officer pauses an agent with a reason (Arabic UI); admin sees it flip and resumes. Two browser contexts — the only cross-session spec. | `@journey:J-A3` |
| [`answer-box.spec.ts`](../../e2e/answer-box.spec.ts) | Authoring an AEO page against a query cluster; record reads Draft. | `@journey:J-M3` |
| [`axis-lifecycle.spec.ts`](../../e2e/axis-lifecycle.spec.ts) | Endorsement (price, then confirm), cancellation (held for approval), renewal-desk re-quote / do-not-contact / bind. | *untagged* |
| [`campaign.spec.ts`](../../e2e/campaign.spec.ts) | Audience + campaign author and launch (auto-approved, audited); a marketer without the permission is refused the whole screen. | `@journey:J-M1 @accept:M4` |
| [`compliance.spec.ts`](../../e2e/compliance.spec.ts) | Scoping and exporting a signed evidence bundle, entirely in Arabic. | `@journey:J-CO1 @accept:M6` |
| [`dev-portal.spec.ts`](../../e2e/dev-portal.spec.ts) | OpenAPI is public, everything else needs a credential; issue a `qvk_test_` key, call the API, revoke it. | `@journey:J-D1 @accept:M1` |
| [`handover.spec.ts`](../../e2e/handover.spec.ts) | Escalation summary + QA scores on the console; agent hands to a teammate; scoring is the lead's job, not the agent's. | `@journey:J-X1 @accept:M3` |
| [`horizon-shell.spec.ts`](../../e2e/horizon-shell.spec.ts) | ⌘K offers the same destinations as the rail and opens one; every screen carries its workspace hue. | *untagged* |
| [`login.spec.ts`](../../e2e/login.spec.ts) | a11y on `/login`; demo one-click sign-in lands `tenant.admin` on its home; password sign-in with tenant slug reaches the same place, including TOTP enrolment. | `@accept:M0` |
| [`north.spec.ts`](../../e2e/north.spec.ts) | Published briefing + anomaly linked action; scenario create and revisit; board pack assembly. | `@journey:J-E1`, `@journey:J-E3`, `@journey:J-E2`, `@accept:M6` |
| [`ops.spec.ts`](../../e2e/ops.spec.ts) | Exception clearing; transaction open + recon confirm with a reason; group-bid quote request and its honest empty compare screen. | `@journey:J-O1`, `@journey:J-O3`, `@journey:J-O2`, `@accept:M2` |
| [`orbit-journeys.spec.ts`](../../e2e/orbit-journeys.spec.ts) | AI draft approved and **queued, not sent**; renewal sweep → propose offers → surfacing needs `axis.lead` → close as Accepted. | `@journey:J-C2`, `@journey:J-C3`, `@accept:M3` |
| [`panel-negotiation.spec.ts`](../../e2e/panel-negotiation.spec.ts) | Commission rate change refused for one actor, approved by a second controller; panel benchmarks readable by the negotiator. | `@journey:J-P2 @accept:M5` |
| [`partner-signup.spec.ts`](../../e2e/partner-signup.spec.ts) | Partner signup mints a scoped sandbox key; quote requests allowed, users denied; duplicate signup throttled. API-only. | `@journey:J-X3 @accept:M3` |
| [`polish-tour.spec.ts`](../../e2e/polish-tour.spec.ts) | Screenshot tour: public, admin, axis, finance, orbit, signal, scout, north, arabic. **Opt-in** — skipped unless `POLISH_OUT` is set. | *untagged, opt-in* |
| [`privacy-portal.spec.ts`](../../e2e/privacy-portal.spec.ts) | DSAR intake returns a `dsr_` reference; an unknown address gets the **identical** response (no enumeration). | `@journey:J-C4 @accept:M6` |
| [`pseudo-locale.spec.ts`](../../e2e/pseudo-locale.spec.ts) | Pseudo-locale string expansion (`⟦` markers) and Arabic RTL on `/login`, plus `/`, `/approvals`, `/admin/customers`. Writes screenshots. | `@accept:M0-rtl` |
| [`save-desk.spec.ts`](../../e2e/save-desk.spec.ts) | A high-premium policy is refused with `axis.bind` and does not appear; a settlement run is always held for `dist.settlement_run`. | `@journey:J-X2` |
| [`scout-whitespace.spec.ts`](../../e2e/scout-whitespace.spec.ts) | Whitespace promotion refused, approved on `/approvals`, then retried successfully. | `@journey:J-P1 @accept:M5` |
| [`self-serve-quote.spec.ts`](../../e2e/self-serve-quote.spec.ts) | Public quote → ranked offers with no internal-signal leakage → choose → upload; the quote page is unreachable without its token. | `@journey:J-C1 @accept:M6` |
| [`signal-budget.spec.ts`](../../e2e/signal-budget.spec.ts) | Reversing an autopilot budget move is held for `signal.budget_move`, approved, retried, and persists. | `@journey:J-M2 @accept:M4` |
| [`staff.spec.ts`](../../e2e/staff.spec.ts) | a11y on `/admin/staff`; invite a teammate with a role bundle; row reads Invited. | `@journey:J-A2 @accept:M1` |
| [`tenant-onboarding.spec.ts`](../../e2e/tenant-onboarding.spec.ts) | Roles and agents provisioned; the tenants list holds exactly one row — your own. Its header documents the platform-admin flow that does **not** exist. | `@journey:J-A1 @accept:M1` |

**Live (read-only, against the deployed site)**

| Spec | Covers |
| --- | --- |
| [`live/smoke.spec.ts`](../../e2e/live/smoke.spec.ts) | `/`, `/approvals`, `/settings` load; the nav's accessible name is `Primary` / `التنقل الرئيسي`; **no raw i18n keys** reach a screen; no "Something went wrong" / "Unexpected Server Error"; axe on `/login` and on the tenant admin's home. |
| [`live/ledger-history.spec.ts`](../../e2e/live/ledger-history.spec.ts) | `/ledger/transactions`, `/statement`, `/period-close`, `/reports/trial-balance`, `/year-end`, `/journal`, `/reports/balance-sheet` all render; the year-end preview contains account **3100** (Retained Earnings); the transaction list exceeds 18 rows, proving the history backfill ran. |
| [`live/sign-in.ts`](../../e2e/live/sign-in.ts) | Helper, not a spec: opens the collapsed **Demo sign-in** disclosure and clicks the persona's button. |

**Simulation (staging, stateful)**

| Spec | Covers |
| --- | --- |
| [`sim/daily.spec.ts`](../../e2e/sim/daily.spec.ts) | One virtual day of realistic usage: NORTH and LEDGER load clean, weekday desk work, a twice-weekly growth check-in, a weekly compliance and queue sweep, and an end-of-run NORTH snapshot. |

### B.5 Live and simulation runs

```
pnpm e2e:live                                       # against https://lyra.vantax.co.za
LIVE_BASE_URL=https://staging.lyra.vantax.co.za pnpm e2e:live
pnpm smoke:staging                                  # tsx scripts/lyra.ts staging smoke
SIM_DAY=1 pnpm e2e:sim                              # one virtual day, 1..30
```

**The live suite never writes.** [`playwright.live.config.ts`](../../playwright.live.config.ts)
starts no web server, wipes no database and seeds nothing; its own comment is
explicit that the specs under `e2e/live` are read-only by construction because
the target is a real deployment. Adding a writing spec there is a review
rejection.

The simulation ([`playwright.staging.config.ts`](../../playwright.staging.config.ts))
is `fullyParallel: false`, 1 worker, 1 retry, and runs `SIM_DAY` 1 through 30 in
order. `SIM_DAY` outside 1..30 throws. Each day advances the demo clock by
86,400,000 ms via `POST /v1/auth/demo/clock` and authenticates through
`POST /v1/auth/demo/login`. **Staging state persists across days on purpose** —
that is what makes day 30 meaningful. Do not "clean up" staging between days.

### B.6 Contract tests

The contract suite is `packages/sdk/src/sdk.test.ts`, run by `pnpm test`. It
asserts:

1. The checked-in `generated.ts` is **byte-identical** to `emit(openapi())` — a
   drifted SDK fails the build rather than shipping stale types.
2. Every path × method in the OpenAPI document has an entry in `OPERATIONS` —
   no endpoint can ship unreachable from the SDK.
3. Page responses paginate with `cursor` (**not** `nextCursor`).
4. `verifyWebhook` accepts a correctly signed payload and rejects a tampered
   one.

Breaking a contract test means a **version bump**, never a silent change. If
the SDK test fails after an API edit, regenerate the SDK — do not edit
`generated.ts` by hand.

### B.7 Model-gateway evals

```
pnpm eval                                    # the gate
pnpm --filter @lyra/model-gateway eval:live  # includes live scorers (LYRA_EVAL_LIVE=1)
```

Evals are written **before** the prompt exists — the golden set and thresholds
are the failing test. Each lives at
`packages/model-gateway/evals/<task>/cases.jsonl` with a `thresholds.json`
beside it. [`evals/run.ts`](../../packages/model-gateway/evals/run.ts) registers
a scorer per directory; **an eval directory with no registered scorer fails the
gate** — a golden set nobody scores is worse than no golden set.

| Eval | Cases | Thresholds | Guards |
| --- | --- | --- | --- |
| `axis` | 24 | `fieldAccuracyMin 0.95` | Document extraction field accuracy, both languages. |
| `axis-vision` | 12 | `fieldAccuracyMin 0.95`, `pageRoutingAccuracyMin 0.98`, `hallucinatedFieldRateMax 0.0` | Vision extraction for documents with no raw text. **Zero** hallucinated fields. |
| `axis-copilot` | 6 | `recallMin 1.0`, `falsePositiveMax 0` | Groundedness of the ops copilot. |
| `axis-fnol-triage` | 8 | `fieldAccuracyMin 0.9` | Claim intake triage. |
| `axis-reserve` | 9 | `medianAbsPctErrorMax 0.25`, `bandCoverageMin 0.8`, `overReserveBiasMax 0.1` | Reserve recommendation accuracy and bias. |
| `axis-fraud` | 60 | `precisionAtTop10Min 0.4`, `recallMin 0.7`, `unexplainedIndicatorRateMax 0.0`, `maxScoreDeltaByProtectedProxy 5` | Fraud scoring. **Every** indicator must be explainable, and a protected-attribute proxy may not move the score by more than 5 points. |
| `axis-sla` | 20 | `aucMin 0.75`, `calibrationErrorMax 0.1`, `leadTimeMedianHoursMin 24` | Breach-probability prediction, with at least 24h median warning. |
| `compliance` | 10 | `hardBlockRecallMin 0.98`, `falsePositiveMax 0`, `ruleMatchMin 1.0` | Regulated-content hard blocks. |
| `injection` | 12 | `recallMin 1.0`, `falsePositiveMax 0` | Prompt-injection detection. **Perfect** recall required. |
| `cx-quality` | 10 | `rubricMin 4.2`, `parityGapMax 0.2`, `scoredMin 1.0` | Conversation quality, with an en/ar parity gap ceiling. |
| `orbit-draft` | 7 | `recallMin 1.0`, `falsePositiveMax 0` | Groundedness of customer reply drafts. |
| `signal` | 8 | `hardBlockRecallMin 1.0`, `falsePositiveMax 0` | Marketing-copy compliance blocks. |
| `north` | 10 | `recallMin 1.0`, `falsePositiveMax 0` | Numeric claims in the executive brief are machine-verified. |
| `live-extraction` | 6 | `fieldAccuracyMin 0.95` | Live-only; skipped unless `LYRA_EVAL_LIVE=1`. |

Output is one line per metric — `PASS`/`FAIL <metric> = <value> (need >= min |
<= max)` — ending in `eval gate: passed` or `eval gate: FAILED` with exit code
1. Two constants worth knowing when reading results:
`SIU_REFERRAL_THRESHOLD = 60` and `BREACH_ALERT_THRESHOLD = 50`.

**A prompt or agent change that does not move a measured eval is a refactor and
must not change eval outputs.** If outputs shift, either the change was not a
refactor or the eval is wrong — resolve it before merging.

### B.8 Mutation testing

```
pnpm mutation                                # core + model-gateway
pnpm --filter @lyra/core mutation
STRYKER_SINCE=origin/main pnpm mutation      # only files changed since a ref
```

Config: [`packages/core/stryker.config.mjs`](../../packages/core/stryker.config.mjs)
and [`packages/model-gateway/stryker.config.mjs`](../../packages/model-gateway/stryker.config.mjs).
Both **must run from the repository root**. Vitest runner,
`coverageAnalysis: "perTest"`, thresholds `{ high: 80, low: 70, break: 70 }` —
**a score under 70 fails the build**, and the threshold is raise-only.

`STRYKER_SINCE` narrows the mutated set via
[`scripts/stryker-changed.mjs`](../../scripts/stryker-changed.mjs). Use it. A
whole-tree run is **14,277 mutants — roughly 10 hours on a CI runner**.

Excluded from mutation: `seed-cli.ts`, `crypto.ts`, `totp.ts` and
`onboarding-templates.ts` in core; the three real provider adapters
(`anthropic.ts`, `workers-ai.ts`, `openai-compat.ts`) in the gateway.

Coverage (`@vitest/coverage-v8`) is **informational only**. Mutation score is
the gate — coverage says a line ran, mutation says a test would have noticed if
it broke.

### B.9 Where reports and artifacts land

| Artifact | Location |
| --- | --- |
| Playwright traces (failures only) | `test-results/<test>/trace.zip` — open with `npx playwright show-trace <path>` |
| Playwright screenshots | `test-results/` — e.g. `pseudo-locale-login.png`, `rtl-ar-login.png` |
| Polish tour screenshots | `$POLISH_OUT` (default `/tmp/lyra-polish-shots`); the tour is skipped unless `POLISH_OUT` is set |
| Stryker HTML report | Per package, from the `html` reporter |
| Eval output | stdout only — capture it in CI logs |
| Generic report output | `reports/` |
| E2E database | `$TMPDIR/lyra-e2e/e2e.db`; uploaded files in `$TMPDIR/lyra-e2e/files` |

`test-results/` and `reports/` are gitignored. Playwright's reporter is `list`
locally and `github` on CI.

### B.10 Flaky-test policy

From [`docs/13-testing-quality.md`](../13-testing-quality.md), and it is
enforced, not aspirational:

- **A flaky test is a Sev-2.** Quarantine it and fix it within **48 hours**.
- The quarantine list must **trend to zero** and is reviewed in every retro.
- **Error-budget burn above 50% freezes feature work** for reliability work.
- Local runs use **0 retries** deliberately — a test that only passes on retry
  locally is already flaky. CI allows 1 retry; a pass-on-retry there is a
  signal to investigate, not a green light.
- Never fix a flake by weakening an assertion, and never by relaxing tenancy,
  audit or approval behaviour. If a spec and a spec document disagree, **the
  spec document wins** — fix the test and note it in the PR.

### B.11 Definition of done for a change

Before a PR merges:

- `pnpm check` green (lint + typecheck + tests); new logic has tests.
- New behaviour arrived **test-first** — reviewers reject implementation-only
  diffs on new behaviour.
- UI change: a story in the design-system playground, and mobile parity noted.
- API change: OpenAPI updated in `packages/sdk`; breaking changes versioned.
- Model behaviour change: an eval case added under
  `packages/model-gateway/evals`, and `pnpm eval` still gates green.
- Audit-log entries verified for every consequential action.
- Bug fix: a **failing regression test first**, named after the issue.
- Docs updated if behaviour diverges from `/docs`.
