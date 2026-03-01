import client, { Registry } from 'prom-client';

const register = new Registry();

// Node.js process metrics (event loop lag, heap, GC)
client.collectDefaultMetrics({ register });

// --- WebSocket ---

const wsConnectionsActive = new client.Gauge({
  name: 'protoimsg_ws_connections_active',
  help: 'Number of authenticated WebSocket connections',
  registers: [register],
});

const wsMessagesTotal = new client.Counter({
  name: 'protoimsg_ws_messages_total',
  help: 'Total WebSocket messages received by type',
  labelNames: ['type'] as const,
  registers: [register],
});

const wsHandlerDuration = new client.Histogram({
  name: 'protoimsg_ws_handler_duration_seconds',
  help: 'WebSocket handler execution time',
  labelNames: ['type'] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

const wsAuthFailuresTotal = new client.Counter({
  name: 'protoimsg_ws_auth_failures_total',
  help: 'Total WebSocket authentication failures',
  registers: [register],
});

// --- Jetstream ---

const jetstreamEventsTotal = new client.Counter({
  name: 'protoimsg_jetstream_events_total',
  help: 'Total Jetstream events processed',
  labelNames: ['collection', 'operation'] as const,
  registers: [register],
});

const jetstreamConnected = new client.Gauge({
  name: 'protoimsg_jetstream_connected',
  help: 'Whether the Jetstream firehose is connected (1=yes, 0=no)',
  registers: [register],
});

const jetstreamLag = new client.Gauge({
  name: 'protoimsg_jetstream_lag_seconds',
  help: 'How far behind Jetstream indexing is in seconds',
  registers: [register],
});

const jetstreamErrorsTotal = new client.Counter({
  name: 'protoimsg_jetstream_errors_total',
  help: 'Total Jetstream processing errors',
  registers: [register],
});

// --- ICE / TURN ---

const iceUnavailableTotal = new client.Counter({
  name: 'protoimsg_ice_unavailable_total',
  help: 'Total ICE server requests that returned 503 (coturn not configured)',
  registers: [register],
});

// --- Translation ---

const translateRequestsTotal = new client.Counter({
  name: 'protoimsg_translate_requests_total',
  help: 'Total translation requests by backend and outcome',
  labelNames: ['backend', 'outcome'] as const,
  registers: [register],
});

const translateDuration = new client.Histogram({
  name: 'protoimsg_translate_duration_seconds',
  help: 'Translation backend request duration in seconds',
  labelNames: ['backend'] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 15, 30],
  registers: [register],
});

const translateTextsTotal = new client.Counter({
  name: 'protoimsg_translate_texts_total',
  help: 'Total texts translated by source',
  labelNames: ['source'] as const,
  registers: [register],
});

const translateBatchSize = new client.Histogram({
  name: 'protoimsg_translate_batch_size',
  help: 'Number of texts per translation request',
  buckets: [1, 2, 5, 10, 20, 30],
  registers: [register],
});

// --- HTTP ---

const httpRequestDuration = new client.Histogram({
  name: 'protoimsg_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

// --- Public API ---

export function incWsConnections(): void {
  wsConnectionsActive.inc();
}

export function decWsConnections(): void {
  wsConnectionsActive.dec();
}

export function getWsConnectionCount(): number {
  return (
    (wsConnectionsActive as unknown as { hashMap: Record<string, { value: number }> }).hashMap['']
      ?.value ?? 0
  );
}

export function incWsMessage(type: string): void {
  wsMessagesTotal.inc({ type });
}

export function observeWsHandlerDuration(type: string, seconds: number): void {
  wsHandlerDuration.observe({ type }, seconds);
}

export function incWsAuthFailure(): void {
  wsAuthFailuresTotal.inc();
}

export function incJetstreamEvent(collection: string, operation: string): void {
  jetstreamEventsTotal.inc({ collection, operation });
}

export function setJetstreamConnected(connected: boolean): void {
  jetstreamConnected.set(connected ? 1 : 0);
}

export function setJetstreamLag(seconds: number): void {
  jetstreamLag.set(seconds);
}

export function incJetstreamError(): void {
  jetstreamErrorsTotal.inc();
}

export function incIceUnavailable(): void {
  iceUnavailableTotal.inc();
}

export function incTranslateRequest(backend: 'libre' | 'nllb', outcome: 'success' | 'error'): void {
  translateRequestsTotal.inc({ backend, outcome });
}

export function observeTranslateDuration(backend: 'libre' | 'nllb', seconds: number): void {
  translateDuration.observe({ backend }, seconds);
}

export function incTranslateTexts(source: 'cache' | 'backend', count: number): void {
  translateTextsTotal.inc({ source }, count);
}

export function observeTranslateBatchSize(size: number): void {
  translateBatchSize.observe(size);
}

export function observeHttpRequestDuration(
  method: string,
  route: string,
  statusCode: number,
  seconds: number,
): void {
  httpRequestDuration.observe({ method, route, status_code: statusCode }, seconds);
}

export async function getMetricsText(): Promise<string> {
  return register.metrics();
}

export function getMetricsContentType(): string {
  return register.contentType;
}
