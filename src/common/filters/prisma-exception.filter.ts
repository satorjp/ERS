import { ArgumentsHost, Catch, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/** Maps common Prisma errors to HTTP errors instead of a generic 500. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const mapping: Record<
      string,
      { status: HttpStatus; error: string; message: string }
    > = {
      P2002: {
        status: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'Resource already exists',
      },
      P2003: {
        status: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'Related resource does not exist',
      },
      P2025: {
        status: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: 'Resource not found',
      },
    };
    const mapped = mapping[exception.code];
    if (!mapped) return super.catch(exception, host);

    host.switchToHttp().getResponse<Response>().status(mapped.status).json({
      message: mapped.message,
      error: mapped.error,
      statusCode: mapped.status,
    });
  }
}
