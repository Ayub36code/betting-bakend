// src/booking/booking.module.ts
import { Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { BookingResolver } from './booking.resolver';

@Module({
  providers: [BookingService, BookingResolver],
  exports: [BookingService],
})
export class BookingModule {}
