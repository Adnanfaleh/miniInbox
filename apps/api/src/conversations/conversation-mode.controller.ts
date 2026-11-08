import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  manualReplySchema,
  type ConversationModeState,
  type ConversationStatusState,
  type ManualReply,
  type ManualReplyCreated,
} from '@mini-inbox/contracts';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ConversationModeService } from './conversation-mode.service.js';

/** Staff actions on one conversation. The tenant comes from the verified request context (header guard). */
@Controller('conversations')
export class ConversationModeController {
  constructor(private readonly service: ConversationModeService) {}

  @Post(':id/takeover')
  @HttpCode(HttpStatus.OK)
  takeover(@Param('id', UuidParamPipe) id: string): Promise<ConversationModeState> {
    return this.service.takeover(id);
  }

  @Post(':id/return-to-ai')
  @HttpCode(HttpStatus.OK)
  returnToAi(@Param('id', UuidParamPipe) id: string): Promise<ConversationModeState> {
    return this.service.returnToAi(id);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@Param('id', UuidParamPipe) id: string): Promise<ConversationStatusState> {
    return this.service.close(id);
  }

  @Post(':id/reply')
  @HttpCode(HttpStatus.CREATED)
  reply(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(manualReplySchema)) body: ManualReply,
  ): Promise<ManualReplyCreated> {
    return this.service.reply(id, body.text);
  }
}
