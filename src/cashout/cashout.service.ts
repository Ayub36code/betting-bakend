// src/cashout/cashout.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { RedisService } from '@redis/redis.service';
import { WalletService } from '@wallet/wallet.service';
import { OddsService } from '@odds/odds.service';
import { ConfigService } from '@nestjs/config';
import {
  calculateCashoutValue,
  calculatePartialCashoutValue,
  calculateCombinedOdds,
} from '@common/utils';
import Decimal from 'decimal.js';
import { Bet, BetSelection, BetStatus } from '@prisma/client';

type BetWithSelections = Bet & {
  selections: (BetSelection & {
    selection: {
      market: {
        isSuspended: boolean;
      };
    };
  })[];
};

@Injectable()
export class CashoutService {
  private readonly logger = new Logger(CashoutService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private walletService: WalletService,
    private oddsService: OddsService,
    private config: ConfigService,
  ) {}

  /**
   * Get live cashout value for a bet (polling / subscription)
   */
  async getCashoutValue(betId: string, userId: string) {
    const bet = await this.prisma.bet.findFirst({
      where: { id: betId, userId },
      include: {
        selections: {
          include: { selection: { include: { market: true } } },
        },
      },
    });

    if (!bet) throw new NotFoundException('Bet not found');

    if (!this._isCashoutEligible(bet)) {
      return {
        eligible: false,
        value: 0,
        reason: this._getCashoutIneligibleReason(bet),
      };
    }

    const cashoutValue = this._calculateCurrentCashoutValue(bet);
    return {
      eligible: true,
      value: new Decimal(cashoutValue).toDecimalPlaces(2).toNumber(),
      originalStake: parseFloat(bet.stake.toString()),
      potentialWin: parseFloat(bet.potentialWin.toString()),
    };
  }

  /**
   * Execute full cashout
   */
  async cashout(betId: string, userId: string) {
    const lockKey = this.redis.keys.cashoutLock(betId);
    const lockToken = await this.redis.acquireLock(lockKey, 10_000);
    if (!lockToken) throw new ConflictException('Cashout already in progress');

    try {
      return await this._executeCashout(betId, userId, false);
    } finally {
      await this.redis.releaseLock(lockKey, lockToken); // ✅ token passed for safe Lua-script release
    }
  }

  /**
   * Execute partial cashout
   */
  async partialCashout(betId: string, userId: string, percentage: number) {
    if (percentage <= 0 || percentage >= 100) {
      throw new BadRequestException(
        'Partial cashout percentage must be between 1-99',
      );
    }

    const lockKey = this.redis.keys.cashoutLock(betId);
    const lockToken = await this.redis.acquireLock(lockKey, 10_000);
    if (!lockToken) throw new ConflictException('Cashout already in progress');

    try {
      return await this._executeCashout(betId, userId, true, percentage);
    } finally {
      await this.redis.releaseLock(lockKey, lockToken); // ✅ token passed for safe Lua-script release
    }
  }

  private async _executeCashout(
    betId: string,
    userId: string,
    isPartial: boolean,
    percentage?: number,
  ) {
    const bet = await this.prisma.bet.findFirst({
      where: { id: betId, userId },
      include: {
        selections: {
          include: { selection: { include: { market: true } } },
        },
      },
    });

    if (!bet) throw new NotFoundException('Bet not found');

    if (!this._isCashoutEligible(bet)) {
      throw new BadRequestException(this._getCashoutIneligibleReason(bet));
    }

    const stake = parseFloat(bet.stake.toString());
    const originalOdds = parseFloat(bet.totalOdds.toString());
    const currentOdds = await this._getLiveOdds(bet);
    const margin = this.config.get<number>('CASHOUT_MARGIN', 0.05);
    const minCashoutOdds = this.config.get<number>('CASHOUT_MIN_ODDS', 1.05);

    if (currentOdds < minCashoutOdds) {
      throw new BadRequestException('Current odds too low for cashout');
    }

    let cashoutAmount: Decimal;
    let remainingStake: number | undefined;

    if (isPartial && percentage) {
      const result = calculatePartialCashoutValue(
        stake,
        percentage,
        originalOdds,
        currentOdds,
        margin,
      );
      cashoutAmount = result.cashoutAmount;
      remainingStake = result.remainingStake.toNumber();
    } else {
      cashoutAmount = calculateCashoutValue(stake, originalOdds, currentOdds, margin);
    }

    if (cashoutAmount.lte(0)) {
      throw new BadRequestException('Cashout value is zero or negative');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedBet = await tx.bet.update({
        where: { id: betId },
        data: isPartial
          ? {
            isPartialCashout: true,
            partialCashoutStake: stake - (remainingStake ?? 0),
            stake: remainingStake,
            potentialWin: new Decimal(remainingStake ?? 0)
              .mul(currentOdds)
              .toDecimalPlaces(2)
              .toNumber(),
          }
          : {
            status: BetStatus.CASHED_OUT,
            cashoutValue: cashoutAmount.toDecimalPlaces(2).toNumber(),
            cashoutOdds: currentOdds,
            cashoutAt: new Date(),
          },
      });

      const cashoutRecord = await tx.cashout.create({
        data: {
          betId,
          userId,
          amount: cashoutAmount.toDecimalPlaces(2).toNumber(),
          isPartial,
          partialStake: isPartial ? stake - (remainingStake ?? 0) : undefined,
          remainingStake: remainingStake,
          oddsAtCashout: currentOdds,
          status: 'COMPLETED',
        },
      });

      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const balance = new Decimal(wallet.balance.toString());
      const newBalance = balance.add(cashoutAmount);

      await tx.wallet.update({
        where: { userId },
        data: {
          balance: newBalance.toDecimalPlaces(2).toNumber(),
          version: { increment: 1 },
        },
      });

      await tx.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: 'CASHOUT',
          status: 'COMPLETED',
          amount: cashoutAmount.toDecimalPlaces(2).toNumber(),
          balanceBefore: balance.toDecimalPlaces(2).toNumber(),
          balanceAfter: newBalance.toDecimalPlaces(2).toNumber(),
          referenceId: cashoutRecord.id,
          referenceType: 'CASHOUT',
          description: `${isPartial ? 'Partial' : 'Full'} cashout for bet ${bet.betRef}`,
        },
      });

      return { bet: updatedBet, cashout: cashoutRecord, cashoutAmount };
    });

    await this.redis.publish(
      'bet:cashed_out',
      JSON.stringify({
        betId,
        userId,
        amount: cashoutAmount.toDecimalPlaces(2).toNumber(),
        isPartial,
      }),
    );

    this.logger.log(
      `Cashout: bet=${bet.betRef} user=${userId} amount=${cashoutAmount} partial=${isPartial}`,
    );

    return {
      bet: result.bet,
      cashoutAmount: result.cashoutAmount.toDecimalPlaces(2).toNumber(),
      isPartial,
    };
  }

  private async _getLiveOdds(bet: BetWithSelections): Promise<number> {
    const currentOddsArr: number[] = [];
    for (const sel of bet.selections) {
      const odds = await this.oddsService.getCurrentOdds(sel.selectionId);
      currentOddsArr.push(odds);
    }
    return calculateCombinedOdds(currentOddsArr).toNumber();
  }

  private _isCashoutEligible(bet: BetWithSelections): boolean {
    return (
      bet.status === BetStatus.ACCEPTED &&
      !bet.cashoutAt &&
      bet.selections.every((s) => !s.selection.market.isSuspended)
    );
  }

  private _getCashoutIneligibleReason(bet: BetWithSelections): string {
    if (bet.status === BetStatus.CASHED_OUT) return 'Bet already cashed out';
    if (bet.status !== BetStatus.ACCEPTED)
      return `Bet is ${bet.status}, cashout not available`;
    if (bet.selections.some((s) => s.selection.market.isSuspended)) {
      return 'One or more markets are suspended';
    }
    return 'Cashout not available for this bet';
  }

  async getCashoutHistory(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.cashout.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { bet: true },
      }),
      this.prisma.cashout.count({ where: { userId } }),
    ]);
    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  private _calculateCurrentCashoutValue(bet: BetWithSelections): number {
    if (bet.status !== BetStatus.ACCEPTED) return 0;

    const selections = bet.selections;
    if (!selections || selections.length === 0) return 0;

    const hasSettledLosers = selections.some(
      (s) => s.isSettled && s.isWinner === false,
    );
    if (hasSettledLosers) return 0;

    const remainingOdds = selections
      .filter((s) => !s.isSettled)
      .reduce((acc, s) => acc * Number(s.odds), 1);

    const settledOdds = selections
      .filter((s) => s.isSettled && s.isWinner === true)
      .reduce((acc, s) => acc * Number(s.odds), 1);

    const currentOdds = settledOdds * remainingOdds;
    const originalOdds = Number(bet.totalOdds);
    const potentialWin = Number(bet.potentialWin);

    const cashoutValue = (currentOdds / originalOdds) * potentialWin;

    // CASHOUT_MARGIN in config is the cut e.g. 0.05 → multiply by 0.95
    const margin = this.config.get<number>('CASHOUT_MARGIN', 0.05);
    const finalValue = cashoutValue * (1 - margin);

    return Math.max(0, Math.min(finalValue, potentialWin));
  }
}