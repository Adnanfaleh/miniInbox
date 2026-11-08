// Shared request/response schemas (Zod), used by the API, the worker and the dashboard.
export { TENANT_HEADER, tenantIdSchema } from './tenant.js';
export { inboundMessageSchema, type InboundMessage, type InboundMessageAccepted } from './webhook.js';
export {
  INBOUND_MESSAGE_QUEUE,
  INBOUND_MESSAGE_JOB,
  inboundMessageJobSchema,
  inboundMessageJobId,
  type InboundMessageJob,
  AI_REPLY_QUEUE,
  AI_REPLY_JOB,
  aiReplyJobSchema,
  aiReplyJobId,
  REPLY_PRIORITY,
  type AiReplyJob,
} from './jobs.js';
export { classificationSchema, CLASSIFICATION_FALLBACK, replySchema, type Classification, type AiReply } from './ai.js';
export { tenantKey, personaCacheKey, PERSONA_CACHE_TTL_SECONDS } from './cache.js';
export { detectLanguage, replyLanguage, type ReplyLanguage } from './language.js';
export {
  manualReplySchema,
  type ManualReply,
  type ConversationMode,
  type ConversationModeState,
  type ManualReplyCreated,
  conversationListQuerySchema,
  conversationDetailQuerySchema,
  type ConversationListQuery,
  type ConversationDetailQuery,
  type SenderTypeDto,
  type ConversationListItem,
  type ConversationListResponse,
  type MessageDto,
  type ConversationDetailResponse,
} from './conversations.js';
export { DAYS, parseWorkingDays } from './working-days.js';
export {
  personaInputSchema,
  knowledgeEntryInputSchema,
  type PersonaInput,
  type KnowledgeEntryInput,
  type PersonaResponse,
} from './persona.js';
