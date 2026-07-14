import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const CORS_ORIGINS = [
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'https://internship-management-app-rouge.vercel.app',
  'https://api.duychien.shop',
  'https://duychien.shop',
  'https://app.duychien.shop',
  'https://backend.backend.svc.cluster.local:3000',
  'http://backend.backend.svc.cluster.local:3001',
  'https://backend.backend.svc.cluster.local:3001',
  'http://backend.backend.svc.cluster.local:3002',
  'https://backend.backend.svc.cluster.local:3002',
  'http://backend.backend.svc.cluster.local:3003',
  'https://backend.backend.svc.cluster.local:3003',
  // Thêm IP local để hỗ trợ đầy đủ các cơ chế gọi từ trình duyệt
  'http://127.0.0.1',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
];

/**
 * Do not set `allowedHeaders` to a fixed list. The underlying `cors` package will
 * mirror `Access-Control-Request-Headers` from the browser preflight when omitted.
 *
 * OpenTelemetry browser instrumentation (`FetchInstrumentation` with
 * `propagateTraceHeaderCorsUrls`) injects W3C trace headers on cross-origin fetch,
 * which changes the preflight header set. A static allow list often breaks after
 * enabling tracing (browser reports a CORS error even though Origin is allowed).
 */
export const CORS_CONFIG: CorsOptions = {
  origin: CORS_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  /** Cache successful preflight; reduces duplicate OPTIONS from the browser. */
  maxAge: 86400,
  // Đảm bảo các request preflight OPTIONS trả về trạng thái 200 thông suốt
  optionsSuccessStatus: 200,
};
