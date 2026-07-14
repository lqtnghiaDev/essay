import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { SwaggerSetupConfig } from './configs/swagger.config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { CORS_CONFIG } from './configs/cors.config';
import { Request, Response } from 'express';
import { ServerResponse } from 'http';
import {
  getPrometheusContentType,
  getPrometheusMetrics,
  observeHttpRequestMetrics,
} from './observability/metrics';
import { bootstrapTracing, shutdownTracing } from './observability/tracing';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  ServerResponse.prototype.setMaxListeners(
    Number(process.env.HTTP_RESPONSE_MAX_LISTENERS ?? 30),
  );

  // Khởi động Tracing trước khi tạo Nest Application
  await bootstrapTracing();

  const app = await NestFactory.create(AppModule);

  // 1. KÍCH HOẠT CORS ĐẦU TIÊN
  // Phải đặt ngay sau khi khởi tạo app để xử lý Preflight (OPTIONS request) từ trình duyệt
  // trước khi đi qua bất kỳ interceptor hay middleware đo lường metrics nào khác.
  app.enableCors(CORS_CONFIG);

  // Cấu hình Logger
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  app.useLogger(app.get(Logger));

  // Xác định cổng chạy (Ưu tiên cổng 3001 ở môi trường phát triển local)
  const port = process.env.PORT || 3001;

  // Bật Socket.IO adapter để WebSocket gateway dùng Socket.IO (realtime notifications)
  app.useWebSocketAdapter(new IoAdapter(app));

  // Middleware đo lường Metrics của Prometheus (đặt sau CORS để tránh nghẽn luồng preflight)
  app.use(observeHttpRequestMetrics);

  const httpServer = app.getHttpAdapter().getInstance();

  httpServer.get('/metrics', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', getPrometheusContentType());
    const metrics = getPrometheusMetrics();
    res.send(metrics);
  });

  // Khởi tạo tài liệu Swagger API
  SwaggerSetupConfig(app);

  // Cấu hình Validation Pipes toàn cục
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    }),
  );

  // Đăng ký Interceptor định dạng lại dữ liệu phản hồi
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Lắng nghe trên mọi mạng interface (0.0.0.0) giúp chấp nhận kết nối từ cả localhost lẫn IP tĩnh
  await app.listen(port, '0.0.0.0');

  const url = await app.getUrl();
  console.log(`Application is running on: ${url}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
}

void bootstrap();

// Xử lý đóng an toàn hệ thống (Graceful Shutdown) và giải phóng OpenTelemetry Tracing
const handleShutdown = (signal: string) => {
  console.log(`Received ${signal}. Shutting down...`);
  shutdownTracing()
    .then(() => {
      console.log('Tracing provider shutdown successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Error during tracing shutdown:', err);
      process.exit(1);
    });
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
