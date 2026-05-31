import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
let sdk: NodeSDK | null = null;

function getOtelCollectorUrl(): string {
  if (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    return process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  }

  const baseEndpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';
  return `${baseEndpoint.replace(/\/$/, '')}/v1/traces`;
}

export async function bootstrapTracing(): Promise<void> {
  if (sdk) {
    return;
  }

  if (process.env.OTEL_ENABLED === 'false') {
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
  }

  const serviceName =
    process.env.OTEL_SERVICE_NAME ?? 'internship-management-be';
  const exporter = new OTLPTraceExporter({
    url: getOtelCollectorUrl(),
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
        process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  await sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  if (!sdk) {
    return;
  }

  await sdk.shutdown();
  sdk = null;
}
