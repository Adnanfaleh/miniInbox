export { createPrismaClient } from './client.js';
export { withTenant, isUuid, type TenantTx, type WithTenantOptions } from './with-tenant.js';
export { lockConversation, type LockedConversation } from './lock.js';
export { RecordNotFoundError, InvalidTenantIdError } from './errors.js';

// Repositories: every function takes (tx, tenantId, ...) and scopes every query by tenantId.
// `tenants` is the only global one (it takes the client, not a tenant transaction).
export { tenants } from './repositories/tenants.js';
export { customers } from './repositories/customers.js';
export { conversations, CONVERSATION_PAGE_MAX } from './repositories/conversations.js';
export { messages, MESSAGE_PAGE_MAX, type CreateMessageInput } from './repositories/messages.js';
export { persona, type PersonaWrite } from './repositories/persona.js';
export { knowledge, KNOWLEDGE_PAGE_MAX } from './repositories/knowledge.js';
export { events, EVENT_PAGE_MAX } from './repositories/events.js';

export { Prisma, PrismaClient } from './generated/prisma/client.js';
export type {
  Tenant,
  PersonaConfig,
  KnowledgeEntry,
  Customer,
  Conversation,
  Message,
  ConversationEvent,
} from './generated/prisma/client.js';
export { Mode, SenderType, EventType, LanguagePreference, Complexity, Intent, ReplyStatus } from './generated/prisma/enums.js';
