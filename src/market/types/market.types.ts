// src/market/types/market.types.ts
import { ObjectType, Field, ID, Float, registerEnumType } from '@nestjs/graphql';
import { MarketStatus, EventStatus } from '@prisma/client';

registerEnumType(MarketStatus, { name: 'MarketStatus' });
registerEnumType(EventStatus, { name: 'EventStatus' });

@ObjectType()
export class SelectionType {
  @Field(() => ID) id: string;
  @Field() marketId: string;
  @Field() name: string;
  @Field({ nullable: true }) code?: string;
  @Field(() => Float) odds: number;
  @Field({ nullable: true }) isWinner?: boolean;
  @Field() isSuspended: boolean;
  @Field({ nullable: true }) runnerNumber?: number;
  @Field() createdAt: Date;
  @Field() updatedAt: Date;
}

@ObjectType()
export class MarketType {
  @Field(() => ID) id: string;
  @Field() eventId: string;
  @Field() name: string;
  @Field() type: string;
  @Field(() => MarketStatus) status: MarketStatus;
  @Field() isSuspended: boolean;
  @Field({ nullable: true }) suspendedReason?: string;
  @Field(() => Float) maxBetAmount: number;
  @Field(() => Float) minBetAmount: number;
  @Field(() => Float) maxExposure: number;
  @Field(() => Float) currentExposure: number;
  @Field({ nullable: true }) cutoffTime?: Date;
  @Field(() => [SelectionType]) selections: SelectionType[];
  @Field() createdAt: Date;
  @Field() updatedAt: Date;
}

@ObjectType()
export class SportType {
  @Field(() => ID) id: string;
  @Field() name: string;
  @Field() slug: string;
  @Field({ nullable: true }) icon?: string;
  @Field() isActive: boolean;
}

@ObjectType()
export class EventType {
  @Field(() => ID) id: string;
  @Field() sportId: string;
  @Field() name: string;
  @Field() slug: string;
  @Field({ nullable: true }) homeTeam?: string;
  @Field({ nullable: true }) awayTeam?: string;
  @Field() startTime: Date;
  @Field({ nullable: true }) endTime?: Date;
  @Field(() => EventStatus) status: EventStatus;
  @Field() isLive: boolean;
  @Field({ nullable: true }) streamUrl?: string;
  @Field(() => SportType, { nullable: true }) sport?: SportType;
  @Field(() => [MarketType], { nullable: true }) markets?: MarketType[];
  @Field() createdAt: Date;
  @Field() updatedAt: Date;
}

@ObjectType()
export class EventListResponse {
  @Field(() => [EventType]) data: EventType[];
  @Field() total: number;
  @Field() page: number;
  @Field() totalPages: number;
}
