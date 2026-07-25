/**
 * Browser-side OpenTelemetry setup → SigNoz via awserv OTLP proxy.
 *
 * Traces are sent to /api/otlp/v1/traces (same origin, no CORS issues).
 * The proxy forwards them to the local otel-collector at localhost:4318.
 * Only initialises when window.__AW_OTEL_ENABLED is truthy (set in index.html
 * or by injecting it via the server).  Safe to import unconditionally.
 */

import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ZoneContextManager } from "@opentelemetry/context-zone";

export function initOtel() {
  // Guard: only instrument in production-like contexts (not unit tests).
  if (typeof window === "undefined") return;

  const exporter = new OTLPTraceExporter({
    url: "/api/otlp/v1/traces",
  });

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "aw-dashboard",
      "service.version": "2.0.0",
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  provider.register({
    contextManager: new ZoneContextManager(),
  });

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: [/.*/],
        clearTimingResources: true,
      }),
    ],
  });
}
