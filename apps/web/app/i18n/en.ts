// Every string the shell renders. A literal in a component is a bug: it cannot
// be translated, and the ar catalogue would silently drift from it.
// Keys are `area.thing`; nav.* keys are the `labelKey` values the API returns
// from /v1/me, so adding a nav item there means adding a key here.

export const en = {
  "app.skipToContent": "Skip to content",
  "app.workspace": "Workspace",
  "app.loading": "Loading",

  "nav.primary": "Primary",
  "nav.home": "Home",
  "nav.axis": "Operations",
  "nav.orbit": "Conversations",
  "nav.signal": "Marketing",
  "nav.scout": "Market",
  "nav.north": "Insight",
  "nav.distribution": "Distribution",
  "nav.ledger": "Ledger",
  "nav.analytics": "Analytics",
  "nav.compliance": "Compliance",
  "nav.admin": "Administration",
  "nav.settings": "Settings",

  "header.account": "Account",
  "header.signedInAs": "Signed in as {name}",
  "header.settings": "Settings",
  "header.signOut": "Sign out",

  "auth.signIn": "Sign in",
  "auth.intro": "Enter your work email and password to continue.",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.tenantSlug": "Workspace",
  "auth.tenantSlug.hint": "Your email belongs to more than one workspace. Enter which one to open.",
  "auth.continue": "Continue",
  "auth.working": "Working…",
  "auth.totp.title": "Two-step verification",
  "auth.totp.intro": "Enter the six-digit code from your authenticator app.",
  "auth.totp.code": "Verification code",
  "auth.totp.verify": "Verify",
  "auth.totp.unavailable":
    "Two-step verification is not available yet. Ask an administrator to finish sign-in for you.",
  "auth.error.credentials": "That email and password do not match. Check both and try again.",
  "auth.error.throttled": "Too many attempts. Wait a few minutes, then try again.",
  "auth.error.locked": "This account cannot sign in. An administrator can restore it.",
  "auth.error.generic": "Sign-in could not be completed. Nothing was changed; you can try again.",
  "auth.error.code": "That code was not accepted. Codes expire quickly — try the current one.",

  "error.title": "This did not load",
  "error.generic": "The page could not be built. Nothing was saved, and you can try again.",
  "error.notFound": "There is nothing at this address.",
  "error.forbidden": "Your roles do not include access to this area.",
  "error.unauthorized": "Your session has ended. Sign in to continue.",
  "error.retry": "Try again",
  "error.requestId": "Reference {id}",
  "error.detail": "Details"
} as const;

export type MessageKey = keyof typeof en;
/** The shape every catalogue must match — enforced at compile time and in test. */
export type Messages = Record<MessageKey, string>;
