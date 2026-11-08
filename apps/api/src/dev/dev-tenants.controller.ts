import { Controller, Get, Header, Inject, NotFoundException } from '@nestjs/common';
import { tenants } from '@mini-inbox/database';
import { API_ENV, type ApiEnv } from '../config/api-env.js';
import { PrismaService } from '../database/prisma.service.js';
import { DevNoTenant } from '../tenant/tenant-from-webhook-url.decorator.js';

/**
 * DEV STAND-IN, NOT AUTHENTICATION. Lists tenants (ID and name only) for the dashboard's development tenant
 * picker. Answers 404 when NODE_ENV is production, so it never exists in a real deployment.
 */
@Controller('dev')
export class DevTenantsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get('tenants')
  @DevNoTenant()
  @Header('Cache-Control', 'private, no-store')
  async list(): Promise<{ id: string; name: string }[]> {
    if (this.env.NODE_ENV === 'production') throw new NotFoundException();
    return tenants.listForDevPicker(this.prisma.client);
  }
}
