# Deployment and trust boundaries

The repository is safe to publish without publishing a hosted demo. A public
deployment needs the controls below because every browser request is ultimately
served with the deployment owner's Drillr API key.

## Required production settings

1. Store `DRILLR_API_KEY`, `RATE_LIMIT_SALT`, and any identity HMAC secret in the
   deployment secret store. Never expose them through browser-prefixed variables.
2. Bind a persistent Cloudflare D1 database as `DB`.
3. Set an explicit `DRILLR_DAILY_REQUEST_LIMIT` that matches the account budget.
4. Set `ADMIN_EMAILS` if stock-universe writes should be enabled. An empty value
   intentionally disables production writes.
5. Confirm the Drillr plan permits the intended public display of returned data.

## Public API controls

The application stores only a keyed HMAC of a client address for rate limiting;
raw addresses are not written to D1. Live, intraday, and signal responses use
short shared caches. Gateway calls also pass through a UTC-day budget and a
failure circuit breaker. These controls reduce accidental or opportunistic
abuse but are not a substitute for Cloudflare WAF rules on a high-traffic demo.

## Administrator identity modes

`TRUSTED_IDENTITY_MODE=disabled` is the secure default.

### HMAC mode (recommended for portable deployments)

Set `TRUSTED_IDENTITY_MODE=hmac` and a random
`TRUSTED_IDENTITY_HMAC_SECRET` of at least 32 characters. A trusted edge proxy
must authenticate the user, remove any client-supplied identity headers, and
inject:

- `oai-authenticated-user-email`
- `oai-authenticated-user-full-name` (optional percent-encoded UTF-8)
- `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`
- `x-drillr-identity-timestamp`: current Unix time in seconds
- `x-drillr-identity-signature`: lowercase hexadecimal HMAC-SHA256

The signed message is exactly:

```text
<timestamp>\n<lowercase email>\n<encoded full-name header or empty string>
```

Signatures older or newer than five minutes are rejected.

### OpenAI Sites mode

`TRUSTED_IDENTITY_MODE=openai-sites` explicitly trusts the OpenAI Sites identity
headers. Use it only when the application is deployed behind that platform's
trusted boundary and outside callers cannot inject or preserve headers with the
same names. Do not use this mode on a generic public Worker route.

## Pre-launch checks

- Run `npm run lint`, `npm test`, and `npm run test:e2e`.
- Verify the public origin cannot mutate `/api/stocks` without a valid identity.
- Verify `429` responses appear when the configured rate is exceeded.
- Verify the D1 database records shared cache and quota state.
- Enable GitHub dependency alerts, secret scanning, push protection, private
  vulnerability reporting, and required CI checks before announcing the repo.
