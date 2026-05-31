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

  await bootstrapTracing();

  const app = await NestFactory.create(AppModule);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  app.useLogger(app.get(Logger));
  const port = process.env.PORT || 3000;

  // Bật Socket.IO adapter để WebSocket gateway dùng Socket.IO (realtime notifications)
  app.useWebSocketAdapter(new IoAdapter(app));
  app.use(observeHttpRequestMetrics);

  const httpServer = app.getHttpAdapter().getInstance();

  httpServer.get('/metrics', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', getPrometheusContentType());
    const metrics = getPrometheusMetrics();
    res.send(metrics);
  });

  SwaggerSetupConfig(app);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableCors(CORS_CONFIG);

  await app.listen(port);

  const url = await app.getUrl();
  console.log(`Application is running on: ${url}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
}

void bootstrap();

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
