// src/odds/odds.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { RedisService } from '@redis/redis.service';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import {
  calculateCombinedOdds,
  decimalToAmerican,
  decimalToFractional,
  americanToDecimal,
} from '@common/utils';

@Injectable()
export class OddsService {
  private readonly logger = new Logger(OddsService.name);
  private readonly ODDS_CACHE_TTL = 30; // seconds
  private readonly ODDS_LOCK_TTL = 30_000; // ms

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private config: ConfigService,
  ) {}

  /**
   * Get current odds for a selection (with Redis cache)
   */
  async getCurrentOdds(selectionId: string): Promise<number> {
    const cacheKey = this.redis.keys.oddsCache(selectionId);
    const cached = await this.redis.get(cacheKey);
    if (cached) return parseFloat(cached);

    const selection = await this.prisma.selection.findUnique({
      where: { id: selectionId },
    });
    if (!selection) throw new BadRequestException(`Selection ${selectionId} not found`);

    await this.redis.set(cacheKey, selection.odds.toString(), this.ODDS_CACHE_TTL);
    return parseFloat(selection.odds.toString());
  }

  /**
   * Lock odds for a selection at bet placement (30-second window)
   */
  async lockOdds(selectionId: string): Promise<{ odds: number; lockToken: string }> {
    const lockKey = this.redis.keys.oddsLock(selectionId);
    const lockToken = await this.redis.acquireLock(lockKey, this.ODDS_LOCK_TTL);

    if (!lockToken) {
      // Another bet is locking this selection - get current odds anyway
      this.logger.warn(`Could not acquire odds lock for selection ${selectionId}`);
    }

    const odds = await this.getCurrentOdds(selectionId);
    return { odds, lockToken: lockToken || 'none' };
  }

  /**
   * Release odds lock
   */
  async releaseOddsLock(selectionId: string, lockToken: string): Promise<void> {
    if (lockToken === 'none') return;
    const lockKey = this.redis.keys.oddsLock(selectionId);
    await this.redis.releaseLock(lockKey, lockToken);
  }

  /**
   * Validate that odds haven't moved adversely since placement
   */
  async validateOddsAtPlacement(
    selectionId: string,
    stakeOdds: number,
    policy: string = 'REJECT',
  ): Promise<{ valid: boolean; currentOdds: number; direction: string }> {
    const currentOdds = await this.getCurrentOdds(selectionId);
    const tolerance = this.config.get<number>('ODDS_CHANGE_TOLERANCE', 0.05);

    const original = new Decimal(stakeOdds);
    const current = new Decimal(currentOdds);
    const diff = current.sub(original).div(original).abs().toNumber();

    let direction = 'SAME';
    if (current.gt(original)) direction = 'BETTER';
    else if (current.lt(original)) direction = 'WORSE';

    let valid = true;
    if (direction === 'WORSE') {
      if (policy === 'REJECT') valid = false;
      else if (policy === 'ACCEPT_BETTER') valid = false;
      else if (policy === 'ACCEPT_ANY') valid = diff <= tolerance;
    }

    return { valid, currentOdds, direction };
  }

  /**
   * Update odds for a selection (triggers cache invalidation and broadcast)
   */
  async updateOdds(
    selectionId: string,
    newOdds: number,
    changedBy?: string,
    reason?: string,
  ) {
    const selection = await this.prisma.selection.findUnique({
      where: { id: selectionId },
    });
    if (!selection) throw new BadRequestException('Selection not found');

    const oldOdds = parseFloat(selection.odds.toString());

    await this.prisma.$transaction([
      this.prisma.selection.update({
        where: { id: selectionId },
        data: { odds: newOdds },
      }),
      this.prisma.oddsHistory.create({
        data: { selectionId, oldOdds, newOdds, changedBy, reason },
      }),
    ]);

    // Invalidate cache
    await this.redis.del(this.redis.keys.oddsCache(selectionId));

    // Publish odds change event
    await this.redis.publish(
      'odds:update',
      JSON.stringify({ selectionId, oldOdds, newOdds, changedBy }),
    );

    this.logger.log(`Odds updated: ${selectionId} ${oldOdds} -> ${newOdds}`);
    return { selectionId, oldOdds, newOdds };
  }

  /**
   * Calculate combined odds for an accumulator
   */
  calculateAccumulatorOdds(oddsArray: number[]): {
    combinedOdds: number;
    impliedProbability: number;
  } {
    const combined = calculateCombinedOdds(oddsArray);
    const implied = new Decimal(1).div(combined).mul(100);
    return {
      combinedOdds: combined.toDecimalPlaces(4).toNumber(),
      impliedProbability: implied.toDecimalPlaces(2).toNumber(),
    };
  }

  /**
   * Convert odds between formats
   */
  convertOdds(
    odds: number,
    from: string,
    to: string,
  ): { decimal: number; american: number; fractional: string } {
    let decimal = odds;
    if (from === 'AMERICAN') decimal = americanToDecimal(odds).toNumber();
    else if (from === 'FRACTIONAL') {
      // "5/2" -> 3.5
      const parts = String(odds).split('/');
      decimal = parseInt(parts[0]) / parseInt(parts[1]) + 1;
    }

    return {
      decimal: parseFloat(decimal.toFixed(4)),
      american: Math.round(decimalToAmerican(decimal)),
      fractional: decimalToFractional(decimal),
    };
  }

  async getOddsHistory(selectionId: string, limit = 20) {
    return this.prisma.oddsHistory.findMany({
      where: { selectionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Bulk suspend/unsuspend selections (e.g., in-play event)
   */
  async suspendSelections(selectionIds: string[], isSuspended: boolean) {
    await this.prisma.selection.updateMany({
      where: { id: { in: selectionIds } },
      data: { isSuspended },
    });

    // Publish suspension event
    await this.redis.publish(
      'selections:suspended',
      JSON.stringify({ selectionIds, isSuspended }),
    );
  }
}
