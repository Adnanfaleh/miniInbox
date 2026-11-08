import { NotFoundException, type PipeTransform } from '@nestjs/common';
import { isUuid } from '@mini-inbox/database';

/**
 * Validates a resource ID in the path. A malformed ID answers 404, the same as an unknown ID or another
 * tenant's ID, so the response never hints at which IDs exist.
 */
export class UuidParamPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (!isUuid(value)) throw new NotFoundException();
    return value;
  }
}
