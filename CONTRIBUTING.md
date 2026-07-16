# Contributing

Thanks for helping improve drillr Market Dashboard. Small, focused changes are
the easiest to review and ship.

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Before you start

- Search existing [issues](https://github.com/huluwa2026/drillr-market-dashboard/issues)
  and [discussions](https://github.com/huluwa2026/drillr-market-dashboard/discussions).
- Use a discussion for setup questions or early product ideas.
- Open an issue before a large UI, data-model, or trust-boundary change so the
  approach can be aligned before implementation.
- Never post API keys, licensed raw market-data responses, customer data, or
  private deployment logs.

Good entry points are labeled
[`good first issue`](https://github.com/huluwa2026/drillr-market-dashboard/labels/good%20first%20issue)
and [`help wanted`](https://github.com/huluwa2026/drillr-market-dashboard/labels/help%20wanted).

## Development setup

```bash
git clone https://github.com/YOUR-USERNAME/drillr-market-dashboard.git
cd drillr-market-dashboard
cp .env.example .env.local
npm install
npx playwright install chromium
npm run dev
```

Add your own `DRILLR_API_KEY` to `.env.local`. Local development uses in-memory
state, so Redis is not required.

## Project guardrails

- Keep the API key and gateway requests server-side.
- Do not add mock market data to a production path.
- Preserve the fixed single-screen desktop layout; tablet and mobile may scroll.
- Show data freshness honestly and keep reduced-motion behavior working.
- Add or update tests when behavior changes.
- Treat changes to identity, admin writes, rate limits, caching, or quotas as
  security-sensitive and explain them in the pull request.
- Keep English and Simplified Chinese product copy in sync.

## Validation

Run the fast checks while developing:

```bash
npm run check
```

Run the browser suite before opening a pull request:

```bash
npm run test:e2e
```

| Command | Checks |
| --- | --- |
| `npm run lint` | ESLint rules |
| `npm run typecheck` | TypeScript correctness |
| `npm test` | Repository invariants and metadata |
| `npm run build` | Production Next.js compilation |
| `npm run test:e2e` | Interactions, security behavior, and visual regression |

Update Playwright baselines only for intentional layout changes with
`npm run test:e2e:update`, then inspect the image diff before committing it.

## Pull requests

1. Fork the repository and create a focused branch.
2. Make the smallest complete change.
3. Add tests and update both READMEs when public behavior changes.
4. Complete the pull request template, including data/security impact.
5. Add before/after screenshots or a short recording for visual changes.
6. Wait for Quality, Production build, Browser and visual tests, and CodeQL to
   pass.

Dependency major versions should be evaluated separately against the peer
dependency ranges supported by Next.js and its ESLint toolchain.

By contributing, you agree that your contribution is licensed under the
[MIT License](./LICENSE).
