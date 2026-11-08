import { Body, Controller, Get, Header, Put } from '@nestjs/common';
import { personaInputSchema, type PersonaInput, type PersonaResponse } from '@mini-inbox/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PersonaService } from './persona.service.js';

/** The calling tenant's persona configuration screen. Validated on the server, not only in the browser. */
@Controller('persona')
export class PersonaController {
  constructor(private readonly service: PersonaService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(): Promise<PersonaResponse> {
    return this.service.get();
  }

  @Put()
  @Header('Cache-Control', 'private, no-store')
  save(@Body(new ZodValidationPipe(personaInputSchema)) body: PersonaInput): Promise<PersonaResponse> {
    return this.service.save(body);
  }
}
