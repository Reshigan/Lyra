// docs/10 §6: the challenge on the two forms a stranger can post without a
// session — portal lead capture and public DSAR intake. The widget writes a
// hidden `cf-turnstile-response` input into the enclosing <form>, which each
// route's action forwards to the API as `turnstileToken`.
//
// No site key bound (dev, on-prem, CI, or any zone where
// infra/cloudflare/turnstile.tf has not been applied) renders nothing, which
// matches the API side: no secret there, no challenge required.

export function Turnstile({ siteKey, locale }: { siteKey: string | null; locale: string }): React.ReactNode {
  if (!siteKey) return null;
  return (
    <>
      {/* React 19 hoists this to <head> and dedupes it by src, so two widgets on
          one document still load the script once. */}
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <div className="cf-turnstile" data-sitekey={siteKey} data-language={locale} data-theme="auto" />
    </>
  );
}
