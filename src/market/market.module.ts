// src/market/market.module.ts
import { Module } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { MarketService } from './market.service';
import { MarketResolver } from './market.resolver';

@Module({
  providers: [
    MarketService,
    MarketResolver,
    { provide: 'PUB_SUB', useValue: new PubSub() },
  ],
  exports: [MarketService],
})
export class MarketModule {}
