import { context, trace } from '@opentelemetry/api';
import { randomUUID } from 'crypto';
import { IncomingMessage } from 'http';
import { Params } from 'nestjs-pino';

function getTraceFields() {
  const span = trace.getSpan(context.active());
  if (!span) {
    return {};
  }

  const spanContext = span.spanContext();
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    trace_flags: spanContext.traceFlags,
  };
}

function getUserId(req: IncomingMessage): string | undefined {
  // req.user is populated by Passport/JWT guard before the response is sent
  const user = (req as IncomingMessage & { user?: { id?: string } }).user;
  return user?.id;
}

export const pinoLoggerConfig: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: process.env.OTEL_SERVICE_NAME ?? 'internship-management-be',
      env: process.env.NODE_ENV ?? 'development',
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
    },
    genReqId: (req, res) => {
      const headerRequestId = req.headers['x-request-id'];
      const requestId =
        typeof headerRequestId === 'string' && headerRequestId.trim() !== ''
          ? headerRequestId
          : randomUUID();

      res.setHeader('x-request-id', requestId);
      return requestId;
    },
    customSuccessMessage: (req, res, responseTime) =>
      `${req.method} ${req.url} ${res.statusCode} ${responseTime}ms`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${req.url} ${res.statusCode} - ${err.message}`,
    customSuccessObject: (req, _res, val) => ({
      ...getTraceFields(),
      response_time_ms: val.responseTime,
      user_id: getUserId(req),
    }),
    customErrorObject: (req, _res, _err, val) => ({
      ...getTraceFields(),
      response_time_ms: val.responseTime,
      user_id: getUserId(req),
    }),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'req.body.password',
        'req.body.currentPassword',
        'req.body.newPassword',
        'req.body.token',
        'req.body.accessToken',
        'req.body.refreshToken',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        remote_address: req.remoteAddress,
        remote_port: req.remotePort,
        user_agent: req.headers['user-agent'],
        query: (req as IncomingMessage & { query?: Record<string, unknown> })
          .query,
      }),
      res: (res) => ({
        status_code: res.statusCode,
      }),
    },
    autoLogging: {
      ignore: (req) => req.url === '/metrics',
    },
  },
};
