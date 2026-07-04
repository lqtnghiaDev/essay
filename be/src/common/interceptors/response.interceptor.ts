/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../dto/api-response.dto';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const response = context.switchToHttp().getResponse();
    const statusCode = response.statusCode;

    return next.handle().pipe(
      map((data) => {
        // Nếu data đã là ApiResponse thì return luôn
        if (
          data &&
          typeof data === 'object' &&
          'statusCode' in data &&
          'message' in data
        ) {
          return data;
        }

        // Tạo success response
        let message = 'Success';

        // Custom message dựa trên HTTP method và status code
        const request = context.switchToHttp().getRequest();
        const method = request.method;

        switch (method) {
          case 'POST':
            message = statusCode === 201 ? 'Created successfully' : 'Success';
            break;
          case 'PUT':
          case 'PATCH':
            message = 'Updated successfully';
            break;
          case 'DELETE':
            message = 'Deleted successfully';
            break;
          case 'GET':
            message = 'Data retrieved successfully';
            break;
          default:
            message = 'Success';
        }

        return ApiResponse.success(data, message, statusCode);
      }),
    );
  }
}
