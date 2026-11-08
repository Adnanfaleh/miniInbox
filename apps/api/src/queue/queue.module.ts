import { Module } from '@nestjs/common';
import { InboundMessageProducer } from './inbound-message.producer.js';

@Module({
  providers: [InboundMessageProducer],
  exports: [InboundMessageProducer],
})
export class QueueModule {}
