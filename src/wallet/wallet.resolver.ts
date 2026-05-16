// src/wallet/wallet.resolver.ts
import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { BalanceResponse, LedgerResponse, TransactionType2, WalletType } from './types/wallet.types';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { CurrentUser, Roles } from '@common/decorators';
import { TransactionType } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Resolver()
export class WalletResolver {
  constructor(private walletService: WalletService) {}

  @Query(() => BalanceResponse)
  async myBalance(@CurrentUser() user: any) {
    return this.walletService.getBalance(user.id);
  }

  @Query(() => WalletType)
  async myWallet(@CurrentUser() user: any) {
    return this.walletService.getWallet(user.id);
  }

  @Query(() => LedgerResponse)
  async myTransactions(
    @CurrentUser() user: any,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
    @Args('type', { type: () => TransactionType, nullable: true }) type?: TransactionType,
  ) {
    return this.walletService.getLedger(user.id, page, limit, type);
  }

  @Mutation(() => TransactionType2)
  async withdraw(
    @CurrentUser() user: any,
    @Args('amount') amount: number,
  ) {
    return this.walletService.withdraw(user.id, amount);
  }

  // Admin
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Mutation(() => TransactionType2)
  async adminDeposit(
    @Args('userId') userId: string,
    @Args('amount') amount: number,
    @Args('reference') reference: string,
  ) {
    return this.walletService.deposit(userId, amount, reference);
  }

  @Roles('SUPER_ADMIN')
  @Mutation(() => TransactionType2)
  async adminRollbackTransaction(
    @CurrentUser() admin: any,
    @Args('transactionId') transactionId: string,
    @Args('reason') reason: string,
  ) {
    return this.walletService.rollback(transactionId, admin.id, reason);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Query(() => LedgerResponse)
  async adminUserTransactions(
    @Args('userId') userId: string,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
  ) {
    return this.walletService.getLedger(userId, page, limit);
  }
}
