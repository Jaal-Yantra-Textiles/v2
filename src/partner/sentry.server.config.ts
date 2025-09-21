// Partner server-side Sentry disabled.
// Backend already has tracing enabled, and client Sentry is initialized in instrumentation-client.ts.
// Keeping this file as a no-op to prevent Next.js from attempting to load @sentry/nextjs on the server,
// which can pull in @prisma/instrumentation and trigger OTel bundling warnings.

import * as Sentry from "@sentry/nextjs";
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
  //  logs
  // Enable logs to be sent to Sentry
  enableLogs: true,
  //  logs
  //  performance
  // Set tracesSampleRate to 1.0 to capture 100%
  // of transactions for tracing.
  // We recommend adjusting this value in production
  // Learn more at
  // https://docs.sentry.io/platforms/javascript/configuration/options/#traces-sample-rate
  tracesSampleRate: 1.0,
  //  performance
});