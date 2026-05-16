// src/bet/bet.resolver.ts
import { Resolver, Query, Mutation, Args, Int, Subscription } from '@nestjs/graphql';
import { UseGuards, Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { BetService } from './bet.service';
import { PlaceBetInput } from './dto/place-bet.input';
import { BetType2, BetListResponse, SettlementResult } from './types/bet.types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, Roles } from '../common/decorators';
import { BetStatus } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Resolver()
export class BetResolver {
  constructor(
    private betService: BetService,
    @Inject('PUB_SUB') private pubSub: PubSub,
  ) {}

  @Mutation(() => BetType2)
  async placeBet(
    @CurrentUser() user: any,
    @Args('input') input: PlaceBetInput,
  ) {
    const bet = await this.betService.placeBet(user.id, input);
    this.pubSub.publish('betPlaced', { betPlaced: bet, userId: user.id });
    return bet;
  }

  @Query(() => BetListResponse)
  async myBets(
    @CurrentUser() user: any,
    @Args('status', { type: () => BetStatus, nullable: true }) status?: BetStatus,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number = 1,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number = 20,
  ) {
    return this.betService.getUserBets(user.id, status, page, limit);
  }

  @Query(() => BetType2)
  async myBet(
    @CurrentUser() user: any,
    @Args('betId') betId: string,
  ) {
    return this.betService.getBet(betId, user.id);
  }

  @Query(() => BetType2)
  async betByRef(@Args('betRef') betRef: string) {
    return this.betService.getBetByRef(betRef);
  }

  @Mutation(() => BetType2)
  async cancelBet(
    @CurrentUser() user: any,
    @Args('betId') betId: string,
  ) {
    return this.betService.cancelBet(betId, user.id);
  }

  // Admin
  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  @Mutation(() => BetType2)
  async adminSettleBet(@Args('betId') betId: string) {
    const bet = await this.betService.settleBet(betId);
    this.pubSub.publish('betSettled', { betSettled: bet });
    return bet;
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  @Mutation(() => SettlementResult)
  async adminSettleBetsByMarket(@Args('marketId') marketId: string) {
    return this.betService.settleBetsByMarket(marketId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Query(() => BetListResponse)
  async adminBets(
    @Args('userId', { nullable: true }) userId?: string,
    @Args('status', { type: () => BetStatus, nullable: true }) status?: BetStatus,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number = 1,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number = 20,
  ) {
    return this.betService.getUserBets(userId || '', status, page, limit);
  }

  // Subscriptions
  @Subscription(() => BetType2, {
    filter: (payload, _, ctx) =>
      payload.userId === ctx.req?.user?.id,
  })
  betPlaced() {
    return this.pubSub.asyncIterator('betPlaced');
  }

  @Subscription(() => BetType2, {
    filter: (payload, _, ctx) =>
      payload.betSettled?.userId === ctx.req?.user?.id,
  })
  betSettled() {
    return this.pubSub.asyncIterator('betSettled');
  }
}
