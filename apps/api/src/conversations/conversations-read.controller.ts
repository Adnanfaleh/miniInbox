import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import {
  conversationDetailQuerySchema,
  conversationListQuerySchema,
  type ConversationDetailQuery,
  type ConversationDetailResponse,
  type ConversationListQuery,
  type ConversationListResponse,
} from '@mini-inbox/contracts';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ConversationsReadService } from './conversations-read.service.js';

/**
 * Dashboard reads. Responses hold one tenant's data, so no shared cache may keep them.
 * The tenant comes from the verified request context (header guard); another tenant's ID answers 404.
 */
@Controller('conversations')
export class ConversationsReadController {
  constructor(private readonly service: ConversationsReadService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query(new ZodValidationPipe(conversationListQuerySchema)) query: ConversationListQuery): Promise<ConversationListResponse> {
    return this.service.list(query);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  detail(
    @Param('id', UuidParamPipe) id: string,
    @Query(new ZodValidationPipe(conversationDetailQuerySchema)) query: ConversationDetailQuery,
  ): Promise<ConversationDetailResponse> {
    return this.service.detail(id, query);
  }
}
