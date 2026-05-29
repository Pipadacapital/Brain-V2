// @paradigm: sql + io/event-handling
//
// gRPC client factory for brain.ingestion.v1.WebhookIngestService.
//
// INTERNAL-ONLY: this client reaches the ingestion-service over the internal
// pod network (never a public address). The target is supplied via env var
// WEBHOOK_INGEST_TARGET (default: localhost:50051) — a plaintext insecure
// channel, network-policy-enforced to the internal CIDR.
//
// HOLD-AT-CUTOVER (NO-LIVE-1): the live target address is HELD-Stage-8.
// Until Stage 8, WEBHOOK_INGEST_TARGET is unset / localhost — no real traffic.
//
// Uses @grpc/proto-loader to dynamically load the proto at runtime. This
// avoids coupling the gateway to a specific codegen plugin version and lets
// the gateway call the Python grpc.aio server with the same proto file that
// both sides share. The @bufbuild/protobuf ES stubs (ingestion_pb.ts) are for
// TypeScript type usage; the runtime wire call goes through grpc-js + proto-loader.
//
// NEVERLOG-1 (Shreya VETO): this module NEVER logs the raw body, the HMAC
// header value, or any PII. Only ids + outcome + error classification.
//
// NO-HARDCODED-VENDOR-1: vendor is a field value passed through from the
// gateway route's :vendor path param. No vendor-literal branch exists here.
// The Python registry is the authority for valid vendors; unknown vendors
// are REJECTED there (default-deny), not pre-filtered here.

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

// Resolve the proto file path relative to this file's location:
//   apps/api-gateway/src/interfaces/ → repo_root/protos/brain/ingestion/v1/ingestion.proto
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(
  __dirname,
  '../../../../../protos/brain/ingestion/v1/ingestion.proto',
);

const PROTO_INCLUDE_DIR = path.resolve(__dirname, '../../../../../protos');

// The Outcome enum values from the proto — kept as constants here so the
// route can map them to HTTP status codes WITHOUT importing the proto-loader
// GrpcObject (which is untyped). These match the proto definition exactly.
// OUTCOME_ACCEPTED=1, OUTCOME_REJECTED=2, OUTCOME_PARKED=3, OUTCOME_IGNORED=4.
export const Outcome = {
  UNSPECIFIED: 0,
  ACCEPTED: 1,
  REJECTED: 2,
  PARKED: 3,
  IGNORED: 4,
} as const;
export type OutcomeValue = (typeof Outcome)[keyof typeof Outcome];

export interface WebhookIngestRequest {
  vendor: string;
  rawBody: Buffer | Uint8Array;
  headers: Record<string, string>;
  requestId: string;
  traceId: string;
}

export interface WebhookIngestResponse {
  outcome: OutcomeValue;
  requestId: string;
}

/** Minimal interface for the gRPC client — only what we use. */
export interface WebhookIngestClient {
  receiveWebhook(
    request: WebhookIngestRequest,
    callback: (
      err: grpc.ServiceError | null,
      response: WebhookIngestResponse,
    ) => void,
  ): grpc.ClientUnaryCall;
  close(): void;
}

/** Load the proto package definition synchronously. Cached at module level. */
let _packageDef: protoLoader.PackageDefinition | null = null;

function loadPackageDef(): protoLoader.PackageDefinition {
  if (!_packageDef) {
    _packageDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,           // camelCase fields (matches TS convention)
      longs: String,
      enums: Number,             // enum fields come back as numbers
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_INCLUDE_DIR],
    });
  }
  return _packageDef;
}

/**
 * Build a gRPC client for WebhookIngestService.
 *
 * target: the internal host:port of the ingestion-service grpc.aio server.
 *   Defaults to WEBHOOK_INGEST_TARGET env var, then 'localhost:50051'.
 *   HOLD-AT-CUTOVER: the real target is HELD-Stage-8.
 *
 * Returns a client and a close() function. The caller (route plugin) owns
 * the lifecycle and calls close() on fastify 'close' event.
 */
export function createWebhookIngestClient(
  target?: string,
): WebhookIngestClient {
  const resolvedTarget =
    target ??
    process.env['WEBHOOK_INGEST_TARGET'] ??
    'localhost:50051';

  const packageDef = loadPackageDef();
  const grpcObject = grpc.loadPackageDefinition(packageDef);

  // Navigate the nested namespace: brain → ingestion → v1 → WebhookIngestService
  const brainNs = grpcObject['brain'] as Record<string, unknown>;
  const ingestionNs = brainNs['ingestion'] as Record<string, unknown>;
  const v1Ns = ingestionNs['v1'] as Record<string, unknown>;
  const ServiceCtor = v1Ns['WebhookIngestService'] as typeof grpc.Client;

  // Insecure channel — network-policy enforced to internal CIDR only.
  // TLS is added at Stage-8 ingress if the pod-to-pod path requires it.
  return new ServiceCtor(
    resolvedTarget,
    grpc.credentials.createInsecure(),
  ) as unknown as WebhookIngestClient;
}

/**
 * Promisified wrapper around receiveWebhook so the route can use
 * async/await cleanly without managing the callback.
 *
 * NEVERLOG-1: the caller MUST NOT log req.rawBody or the signature header value.
 * NO-HARDCODED-VENDOR-1: vendor flows through as req.vendor — no branch on it here.
 */
export function callReceiveWebhook(
  client: WebhookIngestClient,
  req: WebhookIngestRequest,
): Promise<WebhookIngestResponse> {
  return new Promise<WebhookIngestResponse>((resolve, reject) => {
    client.receiveWebhook(req, (err, response) => {
      if (err) {
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
}
