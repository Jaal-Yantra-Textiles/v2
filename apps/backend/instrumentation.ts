// import { registerOtel } from "@medusajs/medusa"
// import { ZipkinExporter } from "@opentelemetry/exporter-zipkin"

// // If using an exporter other than Zipkin, initialize it here.
// const exporter = new ZipkinExporter({
//   serviceName: "my-medusa-project",
// })

// export function register() {
//   registerOtel({
//     serviceName: "medusajs",
//     // pass exporter
//     exporter,
//     instrument: {
//       http: true,
//       workflows: true,
//       query: true,
//       db: true,
//     },
//   })
// }


import Sentry from "@sentry/node"
import otelApi from "@opentelemetry/api"
import { registerOtel } from "@medusajs/medusa"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc" 
import {
  SentrySpanProcessor,
  SentryPropagator,
} from "@sentry/opentelemetry"

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  // @ts-ignore
  instrumenter: "otel",
  enableLogs: true,
})

otelApi.propagation.setGlobalPropagator(new SentryPropagator())

export function register() {
  registerOtel({
    serviceName: "medusa",
    spanProcessors: [new SentrySpanProcessor()],
    traceExporter: new OTLPTraceExporter(),
    instrument: {
      http: true,
      workflows: true,
      query: true,
      db: true,
    },
  })
}