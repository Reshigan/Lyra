# LYRA UI polish & Middle East readiness audit — 2026-08-05

Question answered: *"Is the UI amazing and polished? Can this be a win in the Middle East?"*

**Verdict: strong bones, not yet amazing.** The architecture of polish is in place —
full en/ar label parity on all 48 route label tables, logical CSS everywhere (zero
physical-property defects), a global focus-visible rule, honest empty/permission
states, and a design system that mirrors cleanly in RTL. What separates it from
"amazing" is a finishable list: 58 concrete polish defects, ~30 Arabic copy fixes,
one terminology glossary, Hijri date support, and a screen-routing bug that 404s
several nav links. None are structural. Two focused days of work moves the answer
to yes.

---

## 1. Visual tour (12 screenshots, en + ar, fresh seed)

Captured via `e2e/polish-tour.spec.ts` (tenant admin in English, compliance officer
in Arabic). What the screenshots show:

**Good**
- RTL mirrors correctly on every page shot: nav, cards, tables, badges, numerals.
- Currency renders properly localized (`د.إ` with Arabic-Gregorian month names).
- Permission denial is honest and polished ("This screen needs ledger:txns:create.
  Ask an administrator…").
- Empty states have illustration + copy, not blank panels.
- Customer 360 is dense and legible; propensity meter, ✦ AI-generated badge, and
  status chips all read well.

**Defects visible on screen**
- **Raw ULIDs leak everywhere**: "Requested by us_01KE953T07…", `ses_…` in
  activity, `of_…` on the next-best-offer card, `pr_…` in the shopping table,
  `user:us_…` overflowing an AXIS board card. A customer-facing demo cannot show
  these. Fix: resolve refs to display names server-side, or a `RefChip` that
  truncates + resolves.
- **Timeline dates stay English in Arabic UI** ("Jan 08, 2026, 07:41 AM" inside a
  fully-Arabic home page) — confirms the locale-forwarding defects at
  `home.tsx:572` and `ledger-transaction.tsx:546`.
- **Raw audit action codes** as titles (`core.session.login`,
  `compliance.screening.run`) — needs humanising like customer-360 does.
- Lifetime value shows `AED 0.00` beside `AED 32,330.00` premium written — data
  wiring, but reads as broken on a demo.

## 2. Polish defect sweep (58 findings)

Clean: physical CSS (0), focus styling (global), hardcoded English in routes (0 —
all 48 LABELS tables have full parity).

By class, highest leverage first:
1. **Keyboard/scroll**: shared Table wrapper `packages/ui/src/data.tsx:78` scroll
   region not focusable — one fix covers all 98 tables. Same pattern needed at
   `axis-process-map.tsx:241`, `signal-analytics.tsx:219`, `ai-console.tsx:612`
   (correct reference implementation exists at `quote-compare.tsx:595`).
   Also `data.tsx:141` puts `role="button"` on `<tr>`, breaking table semantics.
2. **packages/ui hardcoded English (16 non-overridable)**: Table empty fallback
   "Nothing here yet." (`data.tsx:182`; 42 of 98 call sites omit `empty`),
   AuditTrail headers (`data.tsx:511-520`, and AuditTrail has no `locale` prop at
   all), ai.tsx strings ("Drafted by…", Accept Tab/Discard Esc, Reject/Approve,
   budget sentences). These are invisible in the label-parity checks because they
   live below the route layer.
3. **Locale not forwarded (3)**: `home.tsx:572`, `ledger-transaction.tsx:546`
   (both have `locale` in scope), `AuditTrail` (API hole).
4. **Raw formatting bypassing Intl (12)**: nine `.toFixed` sites
   (ledger-reports 471, signal-analytics 233, signal-audience-value 131,
   orbit-analytics 498, orbit-quality 391, axis-analytics 412, compliance-run 658,
   admin-cost-explorer 404, north-brief 118) and three bare `toLocaleDateString()`
   (ledger-periods 301, settlement 597, signal-budget 238 — also SSR/hydration
   nondeterministic on workerd).
5. **Non-mirroring `→` glyphs (4)**: orbit-journey 592, ledger-transaction 340,
   axis-process-map 259, signal-cockpit 357.
6. **Repeated link names without aria-label (12+2)**: customer-360:644,
   signal-studio:421, north-brief:457, orbit-journey:548/600, orbit-save:569/587,
   axis-exceptions:463, ai-budget:516, axis-quote-desk:531/542, home:521
   (ApprovalStrip also duplicates region names → axe landmark-unique).
7. **Structural**: `detail-kit.tsx:294-305` pseudo-locale falls through to
   English, blinding the pseudo-locale detector on route-local copy;
   `e2e/pseudo-locale.spec.ts` covers only /login.

## 3. Arabic copy review (~80% natural, 20% flawed)

Flaws read as human inconsistency, not machine translation. Domain vocabulary
(وثيقة، قسط، مطالبة، تكافل، ميزان المراجعة، مدين/دائن) is correct Gulf register.
Customer-facing portal copy is clean. The fix is editorial governance, not
retranslation.

**Single highest-leverage fix: a shared glossary** enforcing one term per concept:

| Concept | Drift today | Pick |
|---|---|---|
| approval | اعتماد / موافقة / إقرار | موافقة |
| tenant | المستأجر / المؤسسة / المنشآت | المؤسسة |
| cross-sell | بيع تكميلي / متقاطع / تكاملي | بيع تكميلي |
| panel (pricing) | اللوحة / اللجنة (both wrong) | قائمة الجهات المسعّرة |
| failed | فشل / فشلت / فاشلة / أخفق | فشل |
| retired (version) | متقاعد / مسحوبة | مسحوبة |
| handover | تحويل / التسليمات | التسليم |
| queue | طابور | قائمة الانتظار |
| autopilot | القائد الآلي | الطيار الآلي |
| tanwin | ـًا vs ـاً mixed | ـًا |

**Top grammar/mistranslation fixes** (worst files: `modules/admin.ts`,
`quote-compare`, `axis-board`, `axis-admin`, `conversation`, `axis-analytics`,
`scout.shared` + `modules/scout.ts`):
- `modules/admin.ts`: `prompts: "المطالبات"` collides with claims → الموجّهات;
  "نص شبحي" → "نص تمهيدي خافت"; "قمرة النمو" → "مركز قيادة النمو".
- `detail-kit.tsx`: "تم القراءة" → "تمت القراءة".
- `conversation.tsx`: broken done.assign → "أُسندت إليك هذه المحادثة…"; assign →
  "إسنادها إليّ".
- `axis-board.tsx`: "صُدرت" → "أُصدرت"; العنبري → الكهرماني.
- `axis-quote-desk.tsx`: "صُدر العقد" → "أُصدر العقد" + سارٍ / مقصورٌ case fixes.
- `staff.tsx`: "لا يوجد مطابقة" → "لا توجد مطابقة"; "من ينوب عن من" → "عمّن ينوب".
- `axis-admin.tsx`: invented verb يقاعد → يسحب.
- `axis-analytics.tsx`: "رقمَي المدة" → "رقما المدة"; "صُمد" → "التُزم".
- settlement مُقرّة vs settlement-detail معتمدة → unify معتمدة; ai-console فشل vs
  ai-run أخفق → unify فشل.
- `scout.ts`: "طلب البحث" → "الطلب عبر البحث"; scout.shared "التعنيد" → "أداة
  التجميع العنقودي".
- `cost-explorer`: "النقل الخارج" → "النقل الخارجي"; `ledger-reports`: "إجمالي
  الهامش" → "الهامش الإجمالي"; `orbit-save`: "أُنقذت" → "استُبقي".

Cleanest files (use as register reference): `ledger.shared.ts`, ledger-reports,
commission-clawback/statement, compliance-run, portal.$tenantSlug, north-brief,
settings, home, admin-security, axis-doc-intel, approvals, claim/policy-detail,
login.

## 4. Hijri calendar plan

The seam already exists: `DateTime` (`packages/ui/src/format.tsx:119-146`) accepts
a `calendar` prop forwarded into `Intl.DateTimeFormat` — zero new formatting code
needed (`Intl` ships `islamic-umalqura`, the Saudi civil calendar).

Plan (small, additive):
1. Tenant config gains `calendarPreference: "gregorian" | "islamic-umalqura" |
   "dual"` (default `gregorian`) — a brand-token-style setting, read the same way
   locale already is.
2. Shell passes it down exactly like `locale`; `DateTime` call sites forward it
   (the same sweep that fixes the locale-forwarding defects above does both).
3. `dual` renders Gregorian with Hijri in a `title`/secondary line — the common
   Gulf business convention (contracts cite both).
4. One golden test per precision using a fixed instant asserting the Umm al-Qura
   rendering, so ICU upgrades can't silently shift dates.

Effort: half a day once the locale-forwarding sweep is done. High signal for KSA
prospects; UAE typically runs Gregorian business calendars.

## 5. Screen coverage & routing gaps

Generic `:module/:resource/:id` routes give every one of ~120 resources a list +
record screen. Bespoke screens: AXIS complete (all 8 routed), Core/Admin, DIST,
LEDGER complete. But:

- **Bug: 10 fully-written route files are not registered in
  `apps/web/app/routes.ts`** — several are nav-linked, so those links 404 live:
  orbit-console, orbit-save, orbit-pipeline, orbit-quality, orbit-analytics
  (linked from `modules/orbit.ts:582-586`), orbit-journey (orbit.ts:412),
  north-brief (north.ts:519), scout-radar, scout-panel, onboarding,
  search-results.
- **Dead links with no file behind them**: /north/explorer, /north/whatif,
  /north/board, /north/health, /north/semantic, /north/usage (north.ts:520-525),
  /north/metric/{id} (north.ts:258).
- No test catches broken hrefs (spec.links.test.ts checks permission filtering
  only) — add a route-exists assertion over module nav specs.
- Mobile is a 4-screen shell (login+TOTP, generic list/record); all 21 MOB-*
  traceability rows not_started.
- `compliance-run.tsx:157-159` screening is an honest, labelled stub.

## 6. Marketing (SIGNAL) vs zeely.ai

Built and working: prompt → copy generation (`POST /v1/signal/creatives/generate`,
kinds ad/lp/email/social/video_script, native ar+en prompt lineages,
compliance-screened at write, drafts only), budget autopilot with pause/resume,
approval gates on creative publish, campaign launch, and budget moves
(human-in-the-loop honored structurally).

Not built (mostly deliberate, per ADR-0015): generation from detected gaps (no
brief generator; scout-whitespace emits no brief), image/video/voice generation,
content calendar/scheduling, **any posting/publishing** (creatives stop at
"review-ready"; zero channel-connector code), social inbox/listening/creators/paid
buying — all 42 SOC-* traceability rows not_started. docs/20 specs the full
zeely-class engine; traceability.csv is stale for SIGNAL (SIG-010/045/001
implemented but marked not_started).

## 7. Prioritized remediation

1. **Route registration fix** (10 unrouted files + dead north links + href test) —
   live 404s, hours of work.
2. **Raw-ID leak sweep** — worst demo-killer visible on screen.
3. **packages/ui i18n pass** — Table empty default, AuditTrail locale + headers,
   ai.tsx strings; plus the three locale-forwarding sites and 12 raw-format sites.
4. **Arabic glossary + top-20 copy fixes** — one file, one editorial pass.
5. **Keyboard pass** — Table wrapper focusability (98 tables in one fix) + 3
   bespoke scrollers + `<tr role="button">`.
6. **Hijri support** — rides on the locale sweep.
7. Aria-labels on repeated links; `→` → mirroring glyph; pseudo-locale fallthrough.
