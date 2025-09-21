"use client"

import * as Sentry from "@sentry/nextjs"

// Client-side Sentry init per project guidance
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
    Sentry.replayIntegration({ blockAllMedia: false, maskAllInputs: false }),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV || process.env.NODE_ENV,
  _experiments: {
    enableLogs: true,
  },
})
