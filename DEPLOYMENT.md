# Vercel deployment and trust boundaries

The repository is safe to publish without publishing a hosted demo. A public
deployment needs the controls below because every browser request is ultimately
served with the deployment owner's Drillr API key.

## Required production services

1. Import the repository into Vercel as a Next.js project.
2. Provision Upstash Redis through the Vercel Marketplace and connect it to the
   project. The app accepts either `UPSTASH_REDIS_REST_URL` plus
   `UPSTASH_REDIS_REST_TOKEN`, or the Vercel aliases `KV_REST_API_URL` plus
   `KV_REST_API_TOKEN`.
3. Store `DRILLR_API_KEY`, `RATE_LIMIT_SALT`, and any identity HMAC secret in
   Vercel Environment Variables. Never expose them through `NEXT_PUBLIC_`
   variables.
4. Set an explicit `DRILLR_DAILY_REQUEST_LIMIT` that matches the account budget.
5. Set `ADMIN_EMAILS` if stock-universe writes should be enabled. An empty value
   intentionally disables production writes.
6. Confirm that the Drillr plan permits the intended public display and
   redistribution of returned market data.

Local development intentionally uses a process-local memory store when Upstash
credentials are absent. Production refuses to serve database-backed routes
without Redis, so an accidental ephemeral deployment cannot silently disable
rate limits or quota tracking.

## Public API controls

The application stores only a keyed HMAC of the Vercel-provided client address;
raw addresses are not written to Redis. Live, intraday, and signal responses use
short shared caches. Gateway calls also pass through a UTC-day budget and a
failure circuit breaker. These controls reduce accidental or opportunistic
abuse but are not a substitute for Vercel Firewall rules on a high-traffic demo.

## Administrator identity modes

`TRUSTED_IDENTITY_MODE=disabled` is the secure default.

### HMAC mode

Set `TRUSTED_IDENTITY_MODE=hmac` and a random
`TRUSTED_IDENTITY_HMAC_SECRET` of at least 32 characters. A trusted proxy must
authenticate the user, remove any client-supplied identity headers, and inject:

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

For an initial read-only public deployment, keep identity mode disabled and
leave `ADMIN_EMAILS` empty. For a private preview, enable Vercel Authentication
under Deployment Protection before adding the Drillr credential.

## Deployment commands

After linking the repository and configuring Redis and secrets:

```bash
vercel          # protected preview deployment
vercel --prod   # public production deployment
```

The project uses the standard `next build`; no custom framework preset or
output directory is required.

## Pre-launch checks

- Run `npm run lint`, `npm test`, and `npm run test:e2e`.
- Verify the preview origin cannot mutate `/api/stocks` without a valid identity.
- Verify `429` responses appear when the configured rate is exceeded.
- Verify Redis contains shared cache, rate-limit, quota, and circuit keys.
- Confirm missing Redis credentials produce a production error rather than an
  in-memory fallback.
- Enable GitHub dependency alerts, secret scanning, push protection, and
  required CI checks before announcing the repository.
