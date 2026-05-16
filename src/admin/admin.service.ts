// src/admin/admin.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { RedisService } from '@redis/redis.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingService } from '../booking/booking.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private bookingService: BookingService,
  ) {}

  // ─── Dashboard Stats ──────────────────────────────────────────────────────

  async getDashboardStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      activeUsers,
      totalBetsToday,
      totalStakedToday,
      totalWonToday,
      openBets,
      openMarkets,
      liveEvents,
      pendingWithdrawals,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.bet.count({ where: { createdAt: { gte: today } } }),
      this.prisma.bet.aggregate({
        where: { createdAt: { gte: today }, status: { notIn: ['CANCELLED', 'VOID'] } },
        _sum: { stake: true },
      }),
      this.prisma.bet.aggregate({
        where: { createdAt: { gte: today }, status: 'WON' },
        _sum: { actualWin: true },
      }),
      this.prisma.bet.count({ where: { status: 'ACCEPTED' } }),
      this.prisma.market.count({ where: { status: 'OPEN' } }),
      this.prisma.event.count({ where: { isLive: true } }),
      this.prisma.transaction.count({ where: { type: 'WITHDRAWAL', status: 'PENDING' } }),
    ]);

    const staked = parseFloat(totalStakedToday._sum.stake?.toString() || '0');
    const won = parseFloat(totalWonToday._sum.actualWin?.toString() || '0');
    const ggr = staked - won; // Gross Gaming Revenue

    return {
      users: { total: totalUsers, active: activeUsers },
      bets: { today: totalBetsToday, open: openBets },
      financials: {
        stakedToday: staked,
        wonToday: won,
        ggr,
        ggrMargin: staked > 0 ? ((ggr / staked) * 100).toFixed(2) : '0',
      },
      markets: { open: openMarkets },
      events: { live: liveEvents },
      pendingWithdrawals,
    };
  }

  // ─── Financial Reports ────────────────────────────────────────────────────

  async getFinancialReport(from: Date, to: Date) {
    const [betsAgg, depositsAgg, withdrawalsAgg, cashoutAgg] = await Promise.all([
      this.prisma.bet.groupBy({
        by: ['status'],
        where: { createdAt: { gte: from, lte: to } },
        _sum: { stake: true, actualWin: true },
        _count: true,
      }),
      this.prisma.transaction.aggregate({
        where: { type: 'DEPOSIT', createdAt: { gte: from, lte: to }, status: 'COMPLETED' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.transaction.aggregate({
        where: { type: 'WITHDRAWAL', createdAt: { gte: from, lte: to }, status: 'COMPLETED' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.cashout.aggregate({
        where: { createdAt: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const totalStaked = betsAgg.reduce((acc, b) => acc + parseFloat(b._sum.stake?.toString() || '0'), 0);
    const totalPaidOut = betsAgg.reduce((acc, b) => acc + parseFloat(b._sum.actualWin?.toString() || '0'), 0);

    return {
      period: { from, to },
      bets: betsAgg.map((b) => ({
        status: b.status,
        count: b._count,
        totalStaked: parseFloat(b._sum.stake?.toString() || '0'),
        totalWon: parseFloat(b._sum.actualWin?.toString() || '0'),
      })),
      totals: {
        staked: totalStaked,
        paidOut: totalPaidOut,
        ggr: totalStaked - totalPaidOut,
      },
      deposits: {
        amount: parseFloat(depositsAgg._sum.amount?.toString() || '0'),
        count: depositsAgg._count,
      },
      withdrawals: {
        amount: Math.abs(parseFloat(withdrawalsAgg._sum.amount?.toString() || '0')),
        count: withdrawalsAgg._count,
      },
      cashouts: {
        amount: parseFloat(cashoutAgg._sum.amount?.toString() || '0'),
        count: cashoutAgg._count,
      },
    };
  }

  // ─── System Config ────────────────────────────────────────────────────────

  async getSystemConfigs(category?: string) {
    const where: any = {};
    if (category) where.category = category;
    return this.prisma.systemConfig.findMany({ where, orderBy: { key: 'asc' } });
  }

  async setSystemConfig(key: string, value: any, updatedBy: string, category = 'GENERAL') {
    return this.prisma.systemConfig.upsert({
      where: { key },
      create: { key, value, category, updatedBy },
      update: { value, updatedBy },
    });
  }

  async getSystemConfig(key: string) {
    const config = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (!config) throw new NotFoundException(`Config key "${key}" not found`);
    return config;
  }

  // ─── Audit Logs ───────────────────────────────────────────────────────────

  async createAuditLog(data: {
    userId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    oldValues?: any;
    newValues?: any;
    ipAddress?: string;
    metadata?: any;
  }) {
    return this.prisma.auditLog.create({ data });
  }

  async getAuditLogs(
    userId?: string,
    resource?: string,
    from?: Date,
    to?: Date,
    page = 1,
    limit = 50,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (userId) where.userId = userId;
    if (resource) where.resource = resource;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true, username: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  // ─── Scheduled Jobs ───────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async cleanExpiredBookings() {
    const count = await this.bookingService.expireOldBookings();
    if (count) this.logger.log(`Expired ${count} bookings`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async resetDailyExposure() {
    // Reset daily staking counters in risk profiles
    await this.prisma.riskProfile.updateMany({
      data: { dailyStaked: 0 },
    });
    this.logger.log('Daily exposure reset');
  }

  @Cron('0 0 * * 1') // Every Monday
  async resetWeeklyExposure() {
    await this.prisma.riskProfile.updateMany({
      data: { weeklyStaked: 0 },
    });
    this.logger.log('Weekly exposure reset');
  }

  // ─── Market Management ────────────────────────────────────────────────────

  async getExposureReport() {
    const markets = await this.prisma.market.findMany({
      where: { status: 'OPEN' },
      select: {
        id: true,
        name: true,
        currentExposure: true,
        maxExposure: true,
        event: { select: { name: true, startTime: true } },
      },
      orderBy: { currentExposure: 'desc' },
      take: 50,
    });

    return markets.map((m) => ({
      ...m,
      exposurePercentage: (
        (parseFloat(m.currentExposure.toString()) / parseFloat(m.maxExposure.toString())) *
        100
      ).toFixed(1),
    }));
  }

  async getTopBettors(limit = 20) {
    return this.prisma.riskProfile.findMany({
      orderBy: { totalStaked: 'desc' },
      take: limit,
      // include: { user: { select: { email: true, username: true } } },
    });
  }
}
