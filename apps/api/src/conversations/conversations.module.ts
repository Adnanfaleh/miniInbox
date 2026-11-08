import { Module } from '@nestjs/common';
import { ConversationModeController } from './conversation-mode.controller.js';
import { ConversationModeService } from './conversation-mode.service.js';
import { ConversationsReadController } from './conversations-read.controller.js';
import { ConversationsReadService } from './conversations-read.service.js';

@Module({
  controllers: [ConversationsReadController, ConversationModeController],
  providers: [ConversationsReadService, ConversationModeService],
})
export class ConversationsModule {}
