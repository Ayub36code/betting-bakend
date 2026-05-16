// src/odds/odds.module.ts
import { Module } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { OddsService } from './odds.service';
import { OddsResolver } from './odds.resolver';

@Module({
  providers: [
    OddsService,
    OddsResolver,
    { provide: 'PUB_SUB', useValue: new PubSub() },
  ],
  exports: [OddsService, { provide: 'PUB_SUB', useExisting: 'PUB_SUB' }],
})
export class OddsModule {}
