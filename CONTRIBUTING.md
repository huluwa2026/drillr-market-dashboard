# Contributing

Thanks for helping improve drillr Market Dashboard.

## Development workflow

1. Fork the repository and create a focused branch.
2. Copy `.env.example` to `.env.local` and add your own Drillr API key.
3. Install dependencies with `npm install`.
4. Run `npm run dev` while developing.
5. Install Chromium once with `npx playwright install chromium`.
6. Run `npm run lint`, `npm test`, and `npm run test:e2e` before opening a pull request.

## Pull requests

- Keep each pull request focused on one change.
- Do not add mock market data to production code.
- Never commit API keys, access tokens, deployment IDs, or customer data.
- Add or update tests when behavior changes.
- Update Playwright baselines intentionally with `npm run test:e2e:update` when the visual layout changes.
- Include a human-readable screenshot in the pull request for visual changes.

By contributing, you agree that your contribution is licensed under the MIT License.
