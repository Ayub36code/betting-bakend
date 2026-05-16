// src/market/market.resolver.ts
import { Resolver, Query, Mutation, Args, Int, Subscription } from '@nestjs/graphql';
import { UseGuards, Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { MarketService } from './market.service';
import {
  EventType,
  EventListResponse,
  MarketType,
  SportType,
} from './types/market.types';
import { CreateEventInput } from './dto/create-market.input';
import { CreateMarketInput } from './dto/create-market.input';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Public, Roles } from '../common/decorators';
import { EventStatus } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Resolver()
export class MarketResolver {
  constructor(
    private marketService: MarketService,
    @Inject('PUB_SUB') private pubSub: PubSub,
  ) {}

  @Public()
  @Query(() => [SportType])
  async sports() {
    return this.marketService.getSports();
  }

  @Public()
  @Query(() => EventListResponse)
  async events(
    @Args('sportId', { nullable: true }) sportId?: string,
    @Args('status', { type: () => EventStatus, nullable: true }) status?: EventStatus,
    @Args('isLive', { nullable: true }) isLive?: boolean,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number = 1,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number = 20,
  ) {
    return this.marketService.getEvents(sportId, status, isLive, page, limit);
  }

  @Public()
  @Query(() => EventType)
  async event(@Args('id') id: string) {
    return this.marketService.getEvent(id);
  }

  @Public()
  @Query(() => MarketType)
  async market(@Args('id') id: string) {
    return this.marketService.getMarket(id);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  @Mutation(() => EventType)
  async createEvent(@Args('input') input: CreateEventInput) {
    return this.marketService.createEvent(input);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  @Mutation(() => EventType)
  async updateEventStatus(
    @Args('id') id: string,
    @Args('status', { type: () => EventStatus }) status: EventStatus,
    @Args('isLive', { nullable: true }) isLive?: boolean,
  ) {
    const event = await this.marketService.updateEventStatus(id, status, isLive);
    this.pubSub.publish('eventUpdated', { eventUpdated: event });
    return event;
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  @Mutation(() => EventType)
  async updateScore(
    @Args('eventId') eventId: string,
    @Args('homeScore', { type: () => Int }) homeScore: number,
    @Args('awayScore', { type: () => Int }) awayScore: number,
  ) {
    const event = await this.marketService.updateScore(eventId, homeScore, awayScore);
    this.pubSub.publish('scoreUpdated', { scoreUpdated: event });
    return event;
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  @Mutation(() => MarketType)
  async createMarket(@Args('input') input: CreateMarketInput) {
    return this.marketService.createMarket(input);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  @Mutation(() => MarketType)
  async suspendMarket(
    @Args('marketId') marketId: string,
    @Args('reason', { nullable: true }) reason?: string,
  ) {
    return this.marketService.suspendMarket(marketId, reason);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  @Mutation(() => MarketType)
  async resumeMarket(@Args('marketId') marketId: string) {
    return this.marketService.resumeMarket(marketId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  @Mutation(() => MarketType)
  async settleMarket(
    @Args('marketId') marketId: string,
    @Args('winnerSelectionId') winnerSelectionId: string,
  ) {
    return this.marketService.settleMarket(marketId, winnerSelectionId);
  }

  // Subscriptions
  @Subscription(() => EventType)
  eventUpdated() {
    return this.pubSub.asyncIterator('eventUpdated');
  }

  @Subscription(() => EventType)
  scoreUpdated() {
    return this.pubSub.asyncIterator('scoreUpdated');
  }
}
