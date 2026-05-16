// src/cashout/cashout.resolver.ts
import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CashoutService } from './cashout.service';
import {
  CashoutValueResponse,
  CashoutResult,
  CashoutHistoryResponse,
} from './types/cashout.types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators';

@UseGuards(JwtAuthGuard, RolesGuard)
@Resolver()
export class CashoutResolver {
  constructor(private cashoutService: CashoutService) {}

  @Query(() => CashoutValueResponse)
  async cashoutValue(
    @CurrentUser() user: any,
    @Args('betId') betId: string,
  ) {
    return this.cashoutService.getCashoutValue(betId, user.id);
  }

  @Mutation(() => CashoutResult)
  async cashout(
    @CurrentUser() user: any,
    @Args('betId') betId: string,
  ) {
    return this.cashoutService.cashout(betId, user.id);
  }

  @Mutation(() => CashoutResult)
  async partialCashout(
    @CurrentUser() user: any,
    @Args('betId') betId: string,
    @Args('percentage', { type: () => Int }) percentage: number,
  ) {
    return this.cashoutService.partialCashout(betId, user.id, percentage);
  }

  @Query(() => CashoutHistoryResponse)
  async myCashouts(
    @CurrentUser() user: any,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
  ) {
    return this.cashoutService.getCashoutHistory(user.id, page, limit);
  }
}
