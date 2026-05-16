// src/risk/risk.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import Decimal from 'decimal.js';

export interface RiskCheckResult {
  approved: boolean;
  reason?: string;
  adjustedStake?: number;
  riskScore?: number;
}

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /**
   * Full risk assessment before accepting a bet
   */
  async assessBet(
    userId: string,
    stake: number,
    totalOdds: number,
    marketId: string,
    potentialWin: number,
  ): Promise<RiskCheckResult> {
    const [user, userProfile, marketExposureOk, dailyLimitOk] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.getOrCreateRiskProfile(userId),
      this.checkMarketExposure(marketId, potentialWin),
      this.checkDailyLoss(userId, stake),
    ]);

    if (!user) return { approved: false, reason: 'User not found' };

    // Self-exclusion check
    if (user.selfExcludedUntil && user.selfExcludedUntil > new Date()) {
      return { approved: false, reason: 'Account self-excluded' };
    }

    // Max bet amount
    if (stake > parseFloat(user.maxBetAmount.toString())) {
      return {
        approved: false,
        reason: `Stake exceeds maximum bet limit of ${user.maxBetAmount}`,
      };
    }

    // Daily loss limit
    if (!dailyLimitOk) {
      return { approved: false, reason: 'Daily loss limit reached' };
    }

    // Market exposure
    if (!marketExposureOk) {
      return { approved: false, reason: 'Market exposure limit reached' };
    }

    // User exposure limit
    const userExposureOk = await this.checkUserExposure(userId, potentialWin);
    if (!userExposureOk) {
      return { approved: false, reason: 'User exposure limit reached' };
    }

    // High-risk odds check (very long odds = possible advantage play)
    if (totalOdds > 1000 && stake > 50) {
      this.logger.warn(`High-odds bet flagged: user=${userId} odds=${totalOdds} stake=${stake}`);
      await this.flagForReview(userId, `High-odds accumulator: odds=${totalOdds}`);
    }

    // Risk score check
    const riskScore = await this.calculateRiskScore(userId, stake, totalOdds);
    if (riskScore > 90) {
      return {
        approved: false,
        reason: 'Risk threshold exceeded. Bet under review.',
        riskScore,
      };
    }

    return { approved: true, riskScore };
  }

  /**
   * Track user exposure in Redis (fast, non-blocking)
   */
  async trackUserExposure(userId: string, potentialWin: number): Promise<void> {
    const key = this.redis.keys.userExposure(userId);
    const exists = await this.redis.exists(key);
    if (!exists) {
      await this.redis.set(key, '0', 86400); // 24h TTL
    }
    await this.redis.incrby(key, Math.round(potentialWin * 100)); // store in cents
  }

  async releaseUserExposure(userId: string, potentialWin: number): Promise<void> {
    const key = this.redis.keys.userExposure(userId);
    const current = await this.redis.get(key);
    if (current) {
      const newVal = Math.max(0, parseInt(current) - Math.round(potentialWin * 100));
      await this.redis.set(key, newVal.toString());
    }
  }

  private async checkUserExposure(userId: string, potentialWin: number): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return false;

    const key = this.redis.keys.userExposure(userId);
    const currentCents = parseInt((await this.redis.get(key)) || '0');
    const currentExposure = currentCents / 100;
    const maxExposure = parseFloat(user.maxExposure.toString());

    return currentExposure + potentialWin <= maxExposure;
  }

  private async checkMarketExposure(marketId: string, potentialWin: number): Promise<boolean> {
    const market = await this.prisma.market.findUnique({ where: { id: marketId } });
    if (!market) return false;
    const current = new Decimal(market.currentExposure.toString());
    const max = new Decimal(market.maxExposure.toString());
    return current.add(potentialWin).lte(max);
  }

  private async checkDailyLoss(userId: string, stake: number): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailyBets = await this.prisma.bet.aggregate({
      where: {
        userId,
        createdAt: { gte: today },
        status: { notIn: ['CANCELLED', 'VOID'] },
      },
      _sum: { stake: true },
    });

    const dailyStake = new Decimal(dailyBets._sum.stake?.toString() || '0');
    const maxDaily = new Decimal(user.maxDailyLoss.toString());
    return dailyStake.add(stake).lte(maxDaily);
  }

  async calculateRiskScore(userId: string, stake: number, odds: number): Promise<number> {
    const profile = await this.getOrCreateRiskProfile(userId);
    let score = profile.riskScore;

    // Boost score for suspicious patterns
    if (odds > 50) score += 10;
    if (odds > 200) score += 15;
    if (stake > 5000) score += 10;
    // if (profile.winRate > 70) score += 20;

    return Math.min(100, score);
  }

  async getOrCreateRiskProfile(userId: string) {
    let profile = await this.prisma.riskProfile.findUnique({ where: { userId } });
    if (!profile) {
      profile = await this.prisma.riskProfile.create({ data: { userId } });
    }
    return profile;
  }

  async updateRiskProfile(userId: string, betSettled: { stake: number; won: boolean; winAmount?: number }) {
    const profile = await this.getOrCreateRiskProfile(userId);
    const newTotal = profile.totalBets + 1;
    const newStaked = new Decimal(profile.totalStaked.toString()).add(betSettled.stake);
    const newWon = profile.totalBets > 0 ? profile.totalBets - 1 : 0;
    const winRate = betSettled.won
      ? ((profile.totalBets - newWon + 1) / newTotal) * 100
      : (newWon / newTotal) * 100;

    await this.prisma.riskProfile.update({
      where: { userId },
      data: {
        totalBets: newTotal,
        totalStaked: newStaked.toNumber(),
        totalWon: betSettled.won
          ? new Decimal(profile.totalWon.toString()).add(betSettled.winAmount || 0).toNumber()
          : undefined,
        winRate,
        biggestWin:
          betSettled.won && betSettled.winAmount
            ? Math.max(parseFloat(profile.biggestWin.toString()), betSettled.winAmount)
            : undefined,
      },
    });
  }

  async flagForReview(userId: string, reason: string) {
    await this.prisma.riskProfile.upsert({
      where: { userId },
      create: { userId, flaggedForReview: true, reviewReason: reason },
      update: { flaggedForReview: true, reviewReason: reason },
    });
    this.logger.warn(`User ${userId} flagged: ${reason}`);
  }

  async getFlaggedUsers(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.riskProfile.findMany({
        where: { flaggedForReview: true },
        skip,
        take: limit,
        orderBy: { riskScore: 'desc' },
      }),
      this.prisma.riskProfile.count({ where: { flaggedForReview: true } }),
    ]);
    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async clearReviewFlag(userId: string) {
    await this.prisma.riskProfile.update({
      where: { userId },
      data: { flaggedForReview: false, reviewReason: null },
    });
  }
}
