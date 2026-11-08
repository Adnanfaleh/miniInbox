import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Request size limits.
 * - Webhook: 32 kB. The largest valid message (4000 characters of text plus IDs) is far below it, and an
 *   oversized request is refused from its Content-Length before the body is read.
 * - Everything else: 1 MB, enough for a persona save with 50 long bilingual knowledge entries.
 */
export const WEBHOOK_BODY_LIMIT_BYTES = 32 * 1024;
export const JSON_BODY_LIMIT = '1mb';

interface SizedRequest {
  headers: Record<string, string | string[] | undefined>;
}
interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/** HTTP setup shared by main.ts and the tests. The app must be created with `bodyParser: false`. */
export function configureHttp(app: NestExpressApplication): void {
  app.use('/webhook', (req: SizedRequest, res: JsonResponse, next: () => void) => {
    if (Number(req.headers['content-length'] ?? 0) > WEBHOOK_BODY_LIMIT_BYTES) {
      res.status(413).json({ statusCode: 413, message: 'Payload Too Large' });
      return;
    }
    next();
  });
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
}
