// src/bet/types/bet.types.ts
import { ObjectType, Field, ID, Float, Int, registerEnumType } from '@nestjs/graphql';
import { BetStatus, BetType } from '@prisma/client';
import { SelectionType } from '../../market/types/market.types';

registerEnumType(BetStatus, { name: 'BetStatus' });
registerEnumType(BetType, { name: 'BetType' });

@ObjectType()
export class BetSelectionType {
  @Field(() => ID) id: string;
  @Field() betId: string;
  @Field() selectionId: string;
  @Field() marketId: string;
  @Field() eventId: string;
  @Field(() => Float) odds: number;
  @Field() isSettled: boolean;
  @Field({ nullable: true }) isWinner?: boolean;
  @Field(() => SelectionType, { nullable: true }) selection?: SelectionType;
}

@ObjectType()
export class BetType2 {
  @Field(() => ID) id: string;
  @Field() userId: string;
  @Field() betRef: string;
  @Field(() => BetType) type: BetType;
  @Field(() => BetStatus) status: BetStatus;
  @Field(() => Float) stake: number;
  @Field(() => Float) potentialWin: number;
  @Field(() => Float, { nullable: true }) actualWin?: number;
  @Field(() => Float) totalOdds: number;
  @Field({ nullable: true }) bookingCode?: string;
  @Field({ nullable: true }) cashoutValue?: number;
  @Field({ nullable: true }) settledAt?: Date;
  @Field({ nullable: true }) voidedAt?: Date;
  @Field({ nullable: true }) voidReason?: string;
  @Field(() => [BetSelectionType]) selections: BetSelectionType[];
  @Field() createdAt: Date;
  @Field() updatedAt: Date;
}

@ObjectType()
export class BetListResponse {
  @Field(() => [BetType2]) data: BetType2[];
  @Field(() => Int) total: number;
  @Field(() => Int) page: number;
  @Field(() => Int) totalPages: number;
}

@ObjectType()
export class SettlementResult {
  @Field(() => Int) settled: number;
  @Field(() => Int) failed: number;
  @Field(() => Int) total: number;
}
