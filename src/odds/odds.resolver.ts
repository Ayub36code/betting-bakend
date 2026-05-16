// src/odds/odds.resolver.ts
import { Resolver, Query, Mutation, Args, Int, Subscription } from '@nestjs/graphql';
import { UseGuards, Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { OddsService } from './odds.service';
import {
  OddsUpdateResponse,
  OddsConversionResponse,
  AccumulatorOddsResponse,
  OddsHistoryType,
} from './types/odds.types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Public } from '../common/decorators';

@UseGuards(JwtAuthGuard, RolesGuard)
@Resolver()
export class OddsResolver {
  constructor(
    private oddsService: OddsService,
    @Inject('PUB_SUB') private pubSub: PubSub,
  ) {}

  @Public()
  @Query(() => OddsConversionResponse)
  convertOdds(
    @Args('odds') odds: number,
    @Args('from', { defaultValue: 'DECIMAL' }) from: string,
    @Args('to', { defaultValue: 'DECIMAL' }) to: string,
  ) {
    return this.oddsService.convertOdds(odds, from, to);
  }

  @Public()
  @Query(() => AccumulatorOddsResponse)
  calculateAccumulatorOdds(
    @Args('odds', { type: () => [Number] }) odds: number[],
  ) {
    return this.oddsService.calculateAccumulatorOdds(odds);
  }

  @Query(() => [OddsHistoryType])
  async oddsHistory(
    @Args('selectionId') selectionId: string,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
  ) {
    return this.oddsService.getOddsHistory(selectionId, limit);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  @Mutation(() => OddsUpdateResponse)
  async updateOdds(
    @Args('selectionId') selectionId: string,
    @Args('newOdds') newOdds: number,
    @Args('reason', { nullable: true }) reason?: string,
  ) {
    const result = await this.oddsService.updateOdds(selectionId, newOdds, undefined, reason);
    this.pubSub.publish('oddsUpdated', { oddsUpdated: result });
    return result;
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  @Mutation(() => Boolean)
  async suspendSelections(
    @Args('selectionIds', { type: () => [String] }) selectionIds: string[],
    @Args('isSuspended') isSuspended: boolean,
  ) {
    await this.oddsService.suspendSelections(selectionIds, isSuspended);
    return true;
  }

  @Subscription(() => OddsUpdateResponse, {
    filter: (payload, variables) =>
      !variables.selectionId ||
      payload.oddsUpdated.selectionId === variables.selectionId,
  })
  oddsUpdated(
    @Args('selectionId', { nullable: true }) _selectionId?: string,
  ) {
    return this.pubSub.asyncIterator('oddsUpdated');
  }
}
