import { Module } from '@nestjs/common';
import { DevTenantsController } from './dev-tenants.controller.js';

/** Development-only routes (tenant picker). Each route refuses to work in production. */
@Module({ controllers: [DevTenantsController] })
export class DevModule {}
