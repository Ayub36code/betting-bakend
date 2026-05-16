// src/market/market.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateEventInput } from './dto/create-event.input';
import { CreateMarketInput } from './dto/create-market.input';
import { MarketStatus, EventStatus } from '@prisma/client';
import Decimal from 'decimal.js';

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  // ─── Sports ──────────────────────────────────────────────────────────────

  async getSports() {
    return this.prisma.sport.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  async getEvents(
    sportId?: string,
    status?: EventStatus,
    isLive?: boolean,
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (sportId) where.sportId = sportId;
    if (status) where.status = status;
    if (isLive !== undefined) where.isLive = isLive;

    const [data, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startTime: 'asc' },
        include: {
          sport: true,
          markets: {
            where: { status: 'OPEN' },
            include: { selections: true },
          },
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async getEvent(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        sport: true,
        markets: {
          include: { selections: { orderBy: { runnerNumber: 'asc' } } },
        },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async createEvent(input: CreateEventInput) {
    return this.prisma.event.create({
      data: {
        sportId: input.sportId,
        name: input.name,
        slug: input.slug || input.name.toLowerCase().replace(/\s+/g, '-'),
        homeTeam: input.homeTeam,
        awayTeam: input.awayTeam,
        startTime: input.startTime,
        status: 'UPCOMING',
      },
      include: { sport: true },
    });
  }

  async updateEventStatus(id: string, status: EventStatus, isLive?: boolean) {
    const event = await this.prisma.event.update({
      where: { id },
      data: {
        status,
        isLive: isLive !== undefined ? isLive : undefined,
        endTime: status === 'FINISHED' ? new Date() : undefined,
      },
    });

    // If event cancelled, suspend all markets
    if (status === 'CANCELLED') {
      await this.prisma.market.updateMany({
        where: { eventId: id, status: 'OPEN' },
        data: { status: 'SUSPENDED', isSuspended: true, suspendedReason: 'Event cancelled' },
      });
    }

    await this.redis.publish('event:status', JSON.stringify({ id, status, isLive }));
    return event;
  }

  async updateScore(eventId: string, homeScore: number, awayScore: number) {
    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: { score: { home: homeScore, away: awayScore } },
    });
    await this.redis.publish(
      'event:score',
      JSON.stringify({ eventId, score: { home: homeScore, away: awayScore } }),
    );
    return event;
  }

  // ─── Markets ──────────────────────────────────────────────────────────────

  async getMarket(id: string) {
    const market = await this.prisma.market.findUnique({
      where: { id },
      include: {
        event: { include: { sport: true } },
        selections: true,
      },
    });
    if (!market) throw new NotFoundException('Market not found');
    return market;
  }

  async createMarket(input: CreateMarketInput) {
    return this.prisma.market.create({
      data: {
        eventId: input.eventId,
        name: input.name,
        type: input.type,
        maxBetAmount: input.maxBetAmount || 10000,
        minBetAmount: input.minBetAmount || 1,
        maxExposure: input.maxExposure || 500000,
        cutoffTime: input.cutoffTime,
        selections: {
          create: input.selections.map((s, i) => ({
            name: s.name,
            code: s.code,
            odds: s.odds,
            runnerNumber: i + 1,
          })),
        },
      },
      include: { selections: true },
    });
  }

  async suspendMarket(marketId: string, reason?: string) {
    const market = await this.prisma.market.update({
      where: { id: marketId },
      data: { status: 'SUSPENDED', isSuspended: true, suspendedReason: reason },
    });
    await this.redis.publish('market:suspended', JSON.stringify({ marketId, reason }));
    return market;
  }

  async resumeMarket(marketId: string) {
    const market = await this.prisma.market.update({
      where: { id: marketId },
      data: { status: 'OPEN', isSuspended: false, suspendedReason: null },
    });
    await this.redis.publish('market:resumed', JSON.stringify({ marketId }));
    return market;
  }

  async settleMarket(marketId: string, winnerSelectionId: string) {
    const market = await this.prisma.market.findUnique({
      where: { id: marketId },
      include: { selections: true },
    });
    if (!market) throw new NotFoundException('Market not found');

    const winner = market.selections.find((s) => s.id === winnerSelectionId);
    if (!winner) throw new BadRequestException('Winner selection not found in market');

    await this.prisma.$transaction([
      this.prisma.market.update({
        where: { id: marketId },
        data: { status: 'SETTLED' },
      }),
      ...market.selections.map((s) =>
        this.prisma.selection.update({
          where: { id: s.id },
          data: { isWinner: s.id === winnerSelectionId },
        }),
      ),
    ]);

    await this.redis.publish(
      'market:settled',
      JSON.stringify({ marketId, winnerSelectionId }),
    );

    this.logger.log(`Market ${marketId} settled. Winner: ${winnerSelectionId}`);
    return market;
  }

  async updateMarketExposure(marketId: string, amount: number) {
    await this.prisma.market.update({
      where: { id: marketId },
      data: { currentExposure: { increment: amount } },
    });
  }

  async checkMarketExposure(marketId: string, newStake: number): Promise<boolean> {
    const market = await this.prisma.market.findUnique({ where: { id: marketId } });
    if (!market) return false;
    const current = new Decimal(market.currentExposure.toString());
    const max = new Decimal(market.maxExposure.toString());
    return current.add(newStake).lte(max);
  }
}
