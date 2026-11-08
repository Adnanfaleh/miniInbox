/**
 * A referenced record does not exist in the current tenant. Callers map this to 404, which is the same
 * response as "belongs to another tenant", so IDs can't be probed (CLAUDE.md section 4.3).
 * The message names the entity only: no IDs, no content.
 */
export class RecordNotFoundError extends Error {
  constructor(readonly entity: string) {
    super(`${entity} not found`);
    this.name = 'RecordNotFoundError';
  }
}

/** A tenant ID that is not a UUID reached the data layer. Treated as "not found" by the API. */
export class InvalidTenantIdError extends Error {
  constructor() {
    super('tenant id is not a valid UUID');
    this.name = 'InvalidTenantIdError';
  }
}
