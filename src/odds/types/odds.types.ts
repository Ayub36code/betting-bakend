// src/odds/types/odds.types.ts
import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

@ObjectType()
export class OddsUpdateResponse {
  @Field(() => ID)
  selectionId: string;

  @Field(() => Float)
  oldOdds: number;

  @Field(() => Float)
  newOdds: number;
}

@ObjectType()
export class OddsConversionResponse {
  @Field(() => Float)
  decimal: number;

  @Field()
  american: number;

  @Field()
  fractional: string;
}

@ObjectType()
export class AccumulatorOddsResponse {
  @Field(() => Float)
  combinedOdds: number;

  @Field(() => Float)
  impliedProbability: number;
}

@ObjectType()
export class OddsHistoryType {
  @Field(() => ID)
  id: string;

  @Field()
  selectionId: string;

  @Field(() => Float)
  oldOdds: number;

  @Field(() => Float)
  newOdds: number;

  @Field({ nullable: true })
  changedBy?: string;

  @Field({ nullable: true })
  reason?: string;

  @Field()
  createdAt: Date;
}
