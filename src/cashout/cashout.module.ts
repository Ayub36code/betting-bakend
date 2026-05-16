// src/cashout/cashout.module.ts
import { Module } from '@nestjs/common';
import { CashoutService } from './cashout.service';
import { CashoutResolver } from './cashout.resolver';
import { WalletModule } from '../wallet/wallet.module';
import { OddsModule } from '../odds/odds.module';

@Module({
  imports: [WalletModule, OddsModule],
  providers: [CashoutService, CashoutResolver],
  exports: [CashoutService],
})
export class CashoutModule {}
