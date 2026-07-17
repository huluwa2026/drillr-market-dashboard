"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

export function sanitizeAnalyticsUrl(url: string): string {
  const queryIndex = url.indexOf("?");
  const hashIndex = url.indexOf("#");
  const firstPrivatePart = [queryIndex, hashIndex]
    .filter((index) => index >= 0)
    .reduce((first, index) => Math.min(first, index), url.length);
  return url.slice(0, firstPrivatePart);
}

export function PrivacyAnalytics() {
  return (
    <Analytics
      beforeSend={(event: BeforeSendEvent) => ({
        ...event,
        url: sanitizeAnalyticsUrl(event.url),
      })}
    />
  );
}

