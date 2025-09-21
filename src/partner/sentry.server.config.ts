import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
  ],
  tracesSampleRate: 1.0,
  environment: process.env.SENTRY_ENV || process.env.NODE_ENV,
  _experiments: { enableLogs: true },
})
