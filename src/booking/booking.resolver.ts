// src/booking/booking.resolver.ts
import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { BookingService } from './booking.service';
import { BookingType, BookingListResponse } from './types/booking.types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, Public } from '../common/decorators';

@UseGuards(JwtAuthGuard)
@Resolver()
export class BookingResolver {
  constructor(private bookingService: BookingService) {}

  @Mutation(() => BookingType)
  async createBookingCode(
    @CurrentUser() user: any,
    @Args('selectionIds', { type: () => [String] }) selectionIds: string[],
  ) {
    return this.bookingService.createBookingCode(user?.id, selectionIds);
  }

  @Public()
  @Query(() => BookingType)
  async loadBookingCode(@Args('code') code: string) {
    return this.bookingService.loadBookingCode(code);
  }

  @Query(() => BookingListResponse)
  async myBookings(
    @CurrentUser() user: any,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
  ) {
    return this.bookingService.getUserBookings(user.id, page, limit);
  }
}
