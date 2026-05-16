// src/cashout/types/cashout.types.ts
import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

@ObjectType()
export class CashoutValueResponse {
  @Field()
  eligible: boolean;

  @Field(() => Float)
  value: number;

  @Field({ nullable: true })
  reason?: string;

  @Field(() => Float, { nullable: true })
  originalStake?: number;

  @Field(() => Float, { nullable: true })
  potentialWin?: number;
}

@ObjectType()
export class CashoutResult {
  @Field(() => Float)
  cashoutAmount: number;

  @Field()
  isPartial: boolean;
}

@ObjectType()
export class CashoutRecord {
  @Field(() => ID) id: string;
  @Field() betId: string;
  @Field() userId: string;
  @Field(() => Float) amount: number;
  @Field() isPartial: boolean;
  @Field(() => Float, { nullable: true }) partialStake?: number;
  @Field(() => Float, { nullable: true }) remainingStake?: number;
  @Field(() => Float) oddsAtCashout: number;
  @Field() status: string;
  @Field() createdAt: Date;
}

@ObjectType()
export class CashoutHistoryResponse {
  @Field(() => [CashoutRecord]) data: CashoutRecord[];
  @Field() total: number;
  @Field() page: number;
  @Field() totalPages: number;
}
