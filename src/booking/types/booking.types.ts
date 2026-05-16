// src/booking/types/booking.types.ts
import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

@ObjectType()
export class BookingSelectionType {
  @Field() selectionId: string;
  @Field() selectionName: string;
  @Field() marketId: string;
  @Field() marketName: string;
  @Field() eventId: string;
  @Field() eventName: string;
  @Field(() => Float) odds: number;
  @Field(() => Float, { nullable: true }) currentOdds?: number;
  @Field({ nullable: true }) isAvailable?: boolean;
  @Field({ nullable: true }) oddsChanged?: boolean;
}

@ObjectType()
export class BookingType {
  @Field(() => ID) id: string;
  @Field() code: string;
  @Field({ nullable: true }) userId?: string;
  @Field(() => [BookingSelectionType]) selections: BookingSelectionType[];
  @Field(() => Float) totalOdds: number;
  @Field(() => Float, { nullable: true }) currentTotalOdds?: number;
  @Field() isExpired: boolean;
  @Field({ nullable: true }) oddsChanged?: boolean;
  @Field({ nullable: true }) allAvailable?: boolean;
  @Field() expiresAt: Date;
  @Field() createdAt: Date;
}

@ObjectType()
export class BookingListResponse {
  @Field(() => [BookingType]) data: BookingType[];
  @Field() total: number;
  @Field() page: number;
  @Field() totalPages: number;
}
