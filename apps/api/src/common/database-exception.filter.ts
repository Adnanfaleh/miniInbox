import { Catch, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { InvalidTenantIdError, Prisma, RecordNotFoundError } from '@mini-inbox/database';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Maps data-layer errors to HTTP. Cross-tenant references surface as "not found" (repository checks) or as
 * FK violations (database backstop): both become 404, never 403, so IDs can't be probed (CLAUDE.md 4.3).
 * Responses carry no Prisma message text, because Prisma errors can echo column values.
 */
@Catch(RecordNotFoundError, InvalidTenantIdError, Prisma.PrismaClientKnownRequestError)
export class DatabaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DatabaseExceptionFilter.name);

  catch(exception: Error, host: ArgumentsHost): void {
    const status = this.statusFor(exception);
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      // Error code only: the message may contain values.
      const code = exception instanceof Prisma.PrismaClientKnownRequestError ? exception.code : exception.name;
      this.logger.error({ code }, 'unhandled database error');
    }
    host
      .switchToHttp()
      .getResponse<JsonResponse>()
      .status(status)
      .json({ statusCode: status, message: this.messageFor(exception, status) });
  }

  private messageFor(exception: Error, status: number): string {
    if (status === 404) return 'Not Found';
    if (status === 409) return isLockTimeout(exception) ? 'Conversation is busy, please retry' : 'Conflict';
    return 'Internal Server Error';
  }

  private statusFor(exception: Error): number {
    if (exception instanceof RecordNotFoundError || exception instanceof InvalidTenantIdError) return HttpStatus.NOT_FOUND;
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025' || exception.code === 'P2003') return HttpStatus.NOT_FOUND;
      if (exception.code === 'P2002') return HttpStatus.CONFLICT;
      // A row lock held longer than the transaction's lock_timeout: the conversation is busy right now.
      if (isLockTimeout(exception)) return HttpStatus.CONFLICT;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}

/** Postgres 55P03 (lock_not_available), raised when `lock_timeout` expires, as reported by the pg driver adapter. */
function isLockTimeout(exception: Error): boolean {
  if (!(exception instanceof Prisma.PrismaClientKnownRequestError) || exception.code !== 'P2010') return false;
  const cause = (exception.meta as { driverAdapterError?: { cause?: { originalCode?: string } } } | undefined)?.driverAdapterError?.cause;
  return cause?.originalCode === '55P03';
}
