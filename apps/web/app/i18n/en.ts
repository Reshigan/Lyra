// Every string the shell renders. A literal in a component is a bug: it cannot
// be translated, and the ar catalogue would silently drift from it.
// Keys are `area.thing`; nav.* keys are the `labelKey` values the API returns
// from /v1/me, so adding a nav item there means adding a key here.

export const en = {
  "app.skipToContent": "Skip to content",
  "app.workspace": "Workspace",
  "app.loading": "Loading",

  "nav.primary": "Primary",

  // The day strip and the shift block at the top of the rail.
  "meridian.title": "Meridian",
  "meridian.landed": "{count} today",
  "shift.title": "Your shift",
  "shift.cleared": "{done} of {total} cleared",
  "shift.left": "{count} still waiting on you",
  "shift.clear": "Nothing waiting on you",

  "nav.breadcrumb": "You are here",
  "nav.home": "Home",
  "nav.group.modules": "Modules",
  "nav.axis": "Operations",
  "nav.orbit": "Conversations",
  "nav.signal": "Marketing",
  "nav.scout": "Market",
  "nav.north": "Insight",
  "nav.group.records": "Records & finance",
  "nav.distribution": "Distribution",
  "nav.ledger": "Ledger",
  "nav.analytics": "Analytics",
  "nav.compliance": "Compliance",
  "nav.group.platform": "Platform",
  "nav.admin": "Administration",
  "nav.platform": "Platform staff",
  "nav.settings": "Settings",

  // Spend, budgets and agents are recorded against module keys the nav has no
  // rail entry for.
  "module.core": "Shared services",
  "module.ai": "AI services",

  "header.account": "Account",
  "header.signedInAs": "Signed in as {name}",
  "header.settings": "Settings",
  "header.signOut": "Sign out",
  "header.themeDark": "Switch to the dark theme",
  "header.themeLight": "Switch to the light theme",

  "auth.signIn": "Sign in",
  "auth.intro": "Enter your work email and password to continue.",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.tenantSlug": "Workspace",
  "auth.tenantSlug.hint": "Your email belongs to more than one workspace. Enter which one to open.",
  "auth.continue": "Continue",
  "auth.working": "Working…",
  "auth.demo.title": "Demo sign-in",
  "auth.demo.intro": "This is a demo workspace. Pick a person to sign in as, or use a password below.",
  "auth.totp.title": "Two-step verification",
  "auth.totp.intro": "Enter the six-digit code from your authenticator app.",
  "auth.totp.code": "Verification code",
  "auth.totp.verify": "Verify",
  "auth.enrol.title": "Set up two-step verification",
  "auth.enrol.intro":
    "Your role requires a second step at sign-in. Add this account to an authenticator app, then enter the code it shows.",
  "auth.enrol.secret": "Setup key",
  "auth.enrol.secretHint": "Paste this key into your authenticator app, or open the link below on this device.",
  "auth.enrol.open": "Open in authenticator app",
  "auth.enrol.confirm": "Confirm",
  "auth.recovery.title": "Save your recovery codes",
  "auth.recovery.intro":
    "Each code signs you in once if you lose your phone. This is the only time they are shown — store them somewhere safe.",
  "auth.recovery.continue": "I have saved them",
  "auth.error.credentials": "That email and password do not match. Check both and try again.",
  "auth.error.throttled": "Too many attempts. Wait a few minutes, then try again.",
  "auth.error.locked": "This account cannot sign in. An administrator can restore it.",
  "auth.error.generic": "Sign-in could not be completed. Nothing was changed; you can try again.",
  "auth.error.code": "That code was not accepted. Codes expire quickly — try the current one.",

  // common.* is the vocabulary every workspace shares. A word a module owns
  // (its nouns, its statuses) lives in that module's own label table instead,
  // because a domain pack may rename it (CLAUDE.md §14).
  "common.search": "Search",
  "search.open": "Search",
  "search.allSurfaces": "All surfaces",
  "search.label": "Search everything",
  "search.placeholder": "Search people, records and requests",
  "search.prompt": "Type at least two letters.",
  "search.none": "Nothing found.",
  "search.goTo": "Go to",
  "search.results": "Results",
  "common.apply": "Apply",
  "common.clear": "Clear",
  "common.all": "All",
  "common.new": "New",
  "common.create": "Create",
  "common.save": "Save changes",
  "common.delete": "Delete",
  "common.cancel": "Cancel",
  "common.dismiss": "Dismiss",
  "common.loading": "Loading",
  "common.edit": "Edit",
  "common.open": "Open",
  "common.back": "Back to list",
  "common.next": "Next",
  "common.previous": "Previous",
  "common.working": "Working…",
  "common.saved": "Saved",
  "common.yes": "Yes",
  "common.no": "No",
  "common.actions": "Actions",
  "common.rows": "{count} shown",
  "common.rowsPerPage": "Rows per page",
  "common.of": "{count} in total",
  "common.deleteConfirm": "Delete this record? It is retained for audit and can be restored by an administrator.",
  // The ask in front of a consequential action (components/confirm.tsx).
  "common.confirmTitle": "Confirm this action",
  "common.confirmGo": "Continue",
  // A gated action (CLAUDE.md §4) refused with `approval_required`. The bespoke
  // detail screens say this already (routes/detail-kit.tsx); the generic record
  // screen used to render the bare policy key, which reads like a crash.
  "common.approvalTitle": "Waiting on an approval",
  "common.approvalBody": "This needs sign-off under {policy} before it can go through.",
  "common.approvalLink": "Open the approval queue",
  "common.restore": "Restore",
  "common.deleted.state": "Records shown",
  "common.deleted.live": "Live records",
  "common.deleted.only": "Deleted records",
  "common.deleted.notice":
    "You are looking at deleted records. They stay out of the live list until you restore them.",
  "common.deleted.back": "Back to live records",
  "common.empty.title": "Nothing here yet",
  "common.empty.body": "No records match this view. Clear the filters, or create the first one.",
  "common.empty.filtered": "No records match these filters.",
  "common.empty.deleted": "Nothing has been deleted here.",
  "common.reveal.title": "Copy this now — it is shown once",
  "common.reveal.body":
    "The server keeps no readable copy. Store it where it belongs before you leave this page; if you lose it, the only remedy is a new record.",
  "common.record": "Record",
  "common.details": "Details",
  "common.history": "History",
  "common.createdAt": "Created",
  "common.updatedAt": "Updated",
  "common.id": "Identifier",
  "common.tabs": "Sections",
  "common.reports": "Reports and tools",
  "common.filters": "Filters",

  "error.title": "This did not load",
  "error.generic": "The page could not be built. Nothing was saved, and you can try again.",
  "error.notFound": "There is nothing at this address.",
  "error.forbidden": "Your roles do not include access to this area.",
  "error.unauthorized": "Your session has ended. Sign in to continue.",
  "error.retry": "Try again",
  "error.requestId": "Reference {id}",
  "error.detail": "Details",
  /* Routes refuse an unrecognised form intent by title. Only reachable if a
     request is made outside the UI, but a refusal is still read by a person. */
  "error.unknownIntent": "That control is not available."
} as const;

export type MessageKey = keyof typeof en;
/** The shape every catalogue must match — enforced at compile time and in test. */
export type Messages = Record<MessageKey, string>;
