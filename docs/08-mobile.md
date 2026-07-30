# 08 — Mobile (apps/mobile, Expo / React Native)

One app, role-adaptive. The thesis: mobile is where decisions happen (exec
brief, approvals, agent triage) and where documents are born (camera). Not a
shrunken dashboard — a decision-and-capture instrument.

## 1. Stack

Expo SDK (managed) + expo-router · TypeScript · NativeWind (same token set as
web via tailwind preset) · Reanimated 3 · expo-secure-store · expo-local-
authentication (Face/Touch ID) · expo-camera + VisionCamera doc-scan flows ·
Notifee/expo-notifications (channels per module) · WatermelonDB or expo-sqlite
+ sync layer for offline · i18n + full RTL (I18nManager, logical styles).
Distribution: EAS builds; tenant-branded builds optional (white-label config →
app name/icon/palette at build time); OTA updates via EAS Update.

## 2. Information architecture

Auth (tenant domain → SSO/password + biometric unlock) → role-adaptive tabs
(max 4 + "More"):

| Role | Tabs |
|---|---|
| Exec (north.exec) | Today (Brief) · Metrics · Anomalies · Approvals |
| Ops (axis.*) | Exceptions · Approvals · Verify · Board |
| CX agent (orbit.agent) | Queue · Conversations · Renewals · Profile |
| Marketer (signal.*) | Cockpit · Approvals · Experiments · Creative |
| Product (scout.*) | Radar · Whitespaces · Bench · Alerts |
| Board (north.board) | Brief · Packs (read-only, watermarked) |
| Tenant admin | Health · People · Approvals · Alerts |

Global: notification inbox, ⌘K-equivalent pull-down search, org switcher for
multi-tenant users (goNXT staff).

## 3. Signature mobile experiences

- **The 7am Brief:** full-screen typographic reading with inline sparkline
  ticks; swipe up for anomalies as cards (Tinder-style triage: assign / snooze
  / explain); voice "ask NORTH" with streamed answer; share-as-image with
  watermark.
- **Approvals Center (all modules):** one unified queue — pricing override,
  budget move, creative flag, pack distribution — biometric confirm on
  consequential approve; every card shows the AI's reasoning summary +
  evidence link.
- **Doc capture (AXIS/consumer SDK):** guided EID/mulkiya scan (edge
  detection, glare warning), on-device pre-checks, background upload with
  retry; extraction result returns as notification.
- **Agent pocket console (ORBIT):** triage queue, quick replies, Tab-accept
  AI drafts, handover; "focus mode" claims one conversation full-screen.
- **Live tiles:** iOS Live Activities / Android ongoing notification for
  SLA-critical cases and campaign launches.

## 4. Offline & sync

Read-models cached locally per role (brief, queues, approvals); mutations go
to an outbox with optimistic UI + conflict policy (server wins, local diff
surfaced); full function on flaky 3G; explicit "offline" chip, never silent
staleness (staleness timestamp on every screen).

## 5. Push & deep links

Notification channels: Critical (SLA breach, consent violation, AI budget
100%), Approvals, Brief, Activity. Every push deep-links to the exact object
(`lyra://m/axis/case/{id}`); web ↔ app link parity. Quiet hours respect
user locale prefs.

## 6. Security

Biometric unlock; secure enclave token storage; screenshot blocking on PII
screens (Android FLAG_SECURE; iOS obscure-on-switcher) tenant-configurable;
remote session revoke; jailbreak/root detection warning mode; board build =
read-only endpoints enforced server-side (not just UI).

## 7. Quality bars

Cold start < 2.0s mid-tier Android; 60fps lists (FlashList); a11y: dynamic
type to 130%, VoiceOver/TalkBack full pass on Brief + Approvals; RTL snapshot
tests; Detox e2e for the five signature flows; crash-free sessions ≥ 99.8%.
