// src/common/filters/http-exception.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { GqlArgumentsHost, GqlExceptionFilter } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter, GqlExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const gqlHost = GqlArgumentsHost.create(host);
    const ctx = gqlHost.getContext();

    this.logger.error('Exception caught', exception);

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message =
        typeof response === 'object' && 'message' in (response as object)
          ? (response as any).message
          : exception.message;

      throw new GraphQLError(
        Array.isArray(message) ? message.join(', ') : message,
        {
          extensions: {
            code: this.getErrorCode(exception.getStatus()),
            status: exception.getStatus(),
          },
        },
      );
    }

    if (exception instanceof Error) {
      throw new GraphQLError(exception.message, {
        extensions: { code: 'INTERNAL_SERVER_ERROR', status: 500 },
      });
    }
  }

  private getErrorCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
    };
    return map[status] || 'UNKNOWN_ERROR';
  }
}
