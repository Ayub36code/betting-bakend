// src/booking/booking.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { RedisService } from '@redis/redis.service';
import { ConfigService } from '@nestjs/config';
import { generateBookingCode } from '@common/utils';
import Decimal from 'decimal.js';

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private config: ConfigService,
  ) {}

  /**
   * Create a booking code from a list of selections
   * Anyone can load and place the same bet using this code
   */
  async createBookingCode(userId: string | undefined, selectionIds: string[]) {
    if (!selectionIds.length) throw new BadRequestException('No selections provided');
    if (selectionIds.length > 20) throw new BadRequestException('Too many selections (max 20)');

    // Fetch selections with current odds
    const selections = await this.prisma.selection.findMany({
      where: { id: { in: selectionIds } },
      include: { market: { include: { event: true } } },
    });

    if (selections.length !== selectionIds.length) {
      throw new BadRequestException('One or more selections not found');
    }

    // Validate all are still open
    for (const sel of selections) {
      if (sel.isSuspended || sel.market.status !== 'OPEN') {
        throw new BadRequestException(`Selection "${sel.name}" is not available`);
      }
    }

    // Calculate combined odds
    const combinedOdds = selections.reduce(
      (acc, s) => acc.mul(new Decimal(s.odds.toString())),
      new Decimal(1),
    );

    const expiryHours = this.config.get<number>('BOOKING_CODE_EXPIRY_HOURS', 24);
    const expiresAt = new Date(Date.now() + expiryHours * 3600 * 1000);
    const code = generateBookingCode();

    // Store in DB
    const booking = await this.prisma.booking.create({
      data: {
        code,
        userId,
        selections: selections.map((s) => ({
          selectionId: s.id,
          selectionName: s.name,
          marketId: s.marketId,
          marketName: s.market.name,
          eventId: s.market.eventId,
          eventName: s.market.event.name,
          odds: parseFloat(s.odds.toString()),
        })),
        totalOdds: combinedOdds.toDecimalPlaces(4).toNumber(),
        expiresAt,
      },
    });

    // Cache in Redis for fast lookup
    await this.redis.set(
      this.redis.keys.bookingCode(code),
      JSON.stringify(booking),
      expiryHours * 3600,
    );

    this.logger.log(`Booking code created: ${code} by user ${userId}`);
    return booking;
  }

  /**
   * Load a booking code - returns selections ready to place
   */
  async loadBookingCode(code: string) {
    // Try Redis cache first
    const cached = await this.redis.get(this.redis.keys.bookingCode(code));
    if (cached) {
      const booking = JSON.parse(cached);
      return this._enrichBooking(booking);
    }

    // Fallback to DB
    const booking = await this.prisma.booking.findUnique({ where: { code } });
    if (!booking) throw new NotFoundException('Booking code not found');
    if (booking.isExpired || booking.expiresAt < new Date()) {
      throw new BadRequestException('Booking code has expired');
    }

    return this._enrichBooking(booking);
  }

  /**
   * Re-enrich booking with current live odds
   */
  private async _enrichBooking(booking: any) {
    const selectionData = booking.selections as Array<{
      selectionId: string;
      selectionName: string;
      marketId: string;
      marketName: string;
      eventId: string;
      eventName: string;
      odds: number;
    }>;

    // Fetch current odds for each selection
    const enriched = await Promise.all(
      selectionData.map(async (s) => {
        const current = await this.prisma.selection.findUnique({
          where: { id: s.selectionId },
          include: { market: true },
        });
        return {
          ...s,
          currentOdds: current ? parseFloat(current.odds.toString()) : s.odds,
          isAvailable: current ? !current.isSuspended && current.market.status === 'OPEN' : false,
          oddsChanged: current
            ? parseFloat(current.odds.toString()) !== s.odds
            : false,
        };
      }),
    );

    const currentCombined = enriched.reduce(
      (acc, s) => acc.mul(s.currentOdds),
      new Decimal(1),
    );

    return {
      ...booking,
      selections: enriched,
      currentTotalOdds: currentCombined.toDecimalPlaces(4).toNumber(),
      oddsChanged: enriched.some((s) => s.oddsChanged),
      allAvailable: enriched.every((s) => s.isAvailable),
    };
  }

  /**
   * Expire stale booking codes (scheduled job)
   */
  async expireOldBookings() {
    const result = await this.prisma.booking.updateMany({
      where: { expiresAt: { lt: new Date() }, isExpired: false },
      data: { isExpired: true },
    });
    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} booking codes`);
    }
    return result.count;
  }

  async getUserBookings(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.booking.count({ where: { userId } }),
    ]);
    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }
}
