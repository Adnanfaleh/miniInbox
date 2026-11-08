import { Module } from '@nestjs/common';
import { PersonaCacheInvalidator } from '../cache/persona-cache-invalidator.js';
import { PersonaController } from './persona.controller.js';
import { PersonaService } from './persona.service.js';

@Module({
  controllers: [PersonaController],
  providers: [PersonaService, PersonaCacheInvalidator],
})
export class PersonaModule {}
