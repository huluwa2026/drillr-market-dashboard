# Security Policy

## Supported versions

Security fixes are applied to the current `main` branch and the public Vercel
deployment. This project does not currently maintain older release branches.

## Reporting a vulnerability

Please do not open a public issue for suspected vulnerabilities.

Use GitHub's private vulnerability reporting for this repository and include:

- the affected route or component;
- reproduction steps;
- expected and observed behavior;
- potential impact;
- a suggested remediation, if available.

Never include live API keys, access tokens, customer data, or other secrets in a report.

The maintainer will acknowledge complete reports on a best-effort basis, keep
the discussion private while the issue is investigated, and coordinate
disclosure after a fix is available. Please do not test rate-limit bypasses or
denial-of-service scenarios against the public demo; reproduce them on your own
deployment instead.

## In scope

- accidental exposure of server-side credentials or upstream responses;
- authorization bypasses for stock-universe writes;
- rate-limit, cache, quota, or identity-boundary bypasses;
- cross-site scripting, request forgery, or injection vulnerabilities;
- vulnerable production dependencies with a practical impact on this app.

Questions about normal setup and usage belong in
[GitHub Discussions](https://github.com/huluwa2026/drillr-market-dashboard/discussions),
not in a private vulnerability report.
