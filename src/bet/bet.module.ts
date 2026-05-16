// src/bet/bet.module.ts
import { Module } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { BetService } from './bet.service';
import { BetResolver } from './bet.resolver';
import { WalletModule } from '../wallet/wallet.module';
import { OddsModule } from '../odds/odds.module';
import { RiskModule } from '../risk/risk.module';
import { MarketModule } from '../market/market.module';

@Module({
  imports: [WalletModule, OddsModule, RiskModule, MarketModule],
  providers: [
    BetService,
    BetResolver,
    { provide: 'PUB_SUB', useValue: new PubSub() },
  ],
  exports: [BetService],
})
export class BetModule {}
