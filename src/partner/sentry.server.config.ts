// Partner server-side Sentry disabled.
// Backend already has tracing enabled, and client Sentry is initialized in instrumentation-client.ts.
// Keeping this file as a no-op to prevent Next.js from attempting to load @sentry/nextjs on the server,
// which can pull in @prisma/instrumentation and trigger OTel bundling warnings.

export {}
