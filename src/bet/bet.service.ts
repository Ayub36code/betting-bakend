// src/bet/bet.service.ts
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
import { RiskService } from '../risk/risk.service';
import { MarketService } from '@market/market.service';
import { PlaceBetInput } from './dto/place-bet.input';
import {
  generateBetRef,
  calculateCombinedOdds,
  calculatePotentialWin,
  getSystemBetCombinations,
} from '@common/utils';
import { BetStatus, BetType } from '@prisma/client';
import Decimal from 'decimal.js';

@Injectable()
export class BetService {
  private readonly logger = new Logger(BetService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private walletService: WalletService,
    private oddsService: OddsService,
    private riskService: RiskService,
    private marketService: MarketService,
  ) {}

  // ─── Place Bet ────────────────────────────────────────────────────────────

  async placeBet(userId: string, input: PlaceBetInput) {
    // 1. Acquire per-user bet lock (prevent double-submission)
    const userLockKey = `bet:user:lock:${userId}`;
    const lockToken = await this.redis.acquireLock(userLockKey, 10_000);
    if (!lockToken) {
      throw new ConflictException('Another bet is being processed. Please wait.');
    }

    try {
      return await this._doPlaceBet(userId, input);
    } finally {
      await this.redis.releaseLock(userLockKey, lockToken);
    }
  }

  private async _doPlaceBet(userId: string, input: PlaceBetInput) {
    const { selectionIds, stake, betType, oddsChangePolicy, systemSize } = input;

    // 2. Validate selection count
    if (betType === 'SINGLE' && selectionIds.length !== 1) {
      throw new BadRequestException('Single bet requires exactly one selection');
    }
    if (betType === 'MULTI' && selectionIds.length < 2) {
      throw new BadRequestException('Multi-bet requires at least 2 selections');
    }
    if (betType === 'SYSTEM' && (!systemSize || selectionIds.length < systemSize)) {
      throw new BadRequestException('Invalid system bet configuration');
    }

    // 3. Fetch and validate all selections
    const selections = await this.prisma.selection.findMany({
      where: { id: { in: selectionIds } },
      include: { market: { include: { event: true } } },
    });

    if (selections.length !== selectionIds.length) {
      throw new BadRequestException('One or more selections not found');
    }

    // 4. Check each selection is valid (market open, event not started, not suspended)
    for (const sel of selections) {
      if (sel.isSuspended) throw new BadRequestException(`Selection "${sel.name}" is suspended`);
      if (sel.market.status !== 'OPEN') {
        throw new BadRequestException(`Market "${sel.market.name}" is not open`);
      }
      if (sel.market.isSuspended) {
        throw new BadRequestException(`Market "${sel.market.name}" is suspended`);
      }
      if (sel.market.event.status === 'FINISHED' || sel.market.event.status === 'CANCELLED') {
        throw new BadRequestException(`Event "${sel.market.event.name}" is no longer available`);
      }
      if (new Date() > sel.market.event.startTime && !sel.market.event.isLive) {
        throw new BadRequestException(`Event "${sel.market.event.name}" has already started`);
      }
      if (sel.market.cutoffTime && new Date() > sel.market.cutoffTime) {
        throw new BadRequestException(`Betting cutoff passed for market "${sel.market.name}"`);
      }
      // Validate stake vs market limits
      if (stake < parseFloat(sel.market.minBetAmount.toString())) {
        throw new BadRequestException(`Minimum bet amount is ${sel.market.minBetAmount}`);
      }
      if (stake > parseFloat(sel.market.maxBetAmount.toString())) {
        throw new BadRequestException(`Maximum bet amount is ${sel.market.maxBetAmount}`);
      }
    }

    // 5. Check for duplicate events in multi-bet
    if (betType !== 'SINGLE') {
      const eventIds = selections.map((s) => s.market.event.id);
      const unique = new Set(eventIds);
      if (unique.size !== eventIds.length) {
        throw new BadRequestException('Multi-bet cannot contain selections from the same event');
      }
    }

    // 6. Lock and validate odds for each selection
    const oddsLocks: Array<{ selectionId: string; token: string }> = [];
    const lockedOdds: Record<string, number> = {};

    try {
      for (const sel of selections) {
        const { odds, lockToken } = await this.oddsService.lockOdds(sel.id);
        oddsLocks.push({ selectionId: sel.id, token: lockToken });

        // Check for odds movement
        const stakeOdds = parseFloat(sel.odds.toString());
        const validation = await this.oddsService.validateOddsAtPlacement(
          sel.id,
          stakeOdds,
          oddsChangePolicy || 'REJECT',
        );

        if (!validation.valid) {
          throw new BadRequestException(
            `Odds for "${sel.name}" changed from ${stakeOdds} to ${validation.currentOdds}. Bet rejected due to odds policy.`,
          );
        }
        lockedOdds[sel.id] = validation.currentOdds;
      }

      // 7. Calculate combined odds and potential win
      let totalOdds: Decimal;
      let potentialWin: Decimal;

      if (betType === 'SYSTEM' && systemSize) {
        // System bet: sum of potential wins across all combinations
        const combinations = getSystemBetCombinations(selections, systemSize);
        const stakePerCombo = new Decimal(stake).div(combinations.length);
        potentialWin = combinations.reduce((acc, combo) => {
          const comboOdds = calculateCombinedOdds(combo.map((s) => lockedOdds[s.id]));
          return acc.add(stakePerCombo.mul(comboOdds));
        }, new Decimal(0));
        totalOdds = potentialWin.div(stake); // effective combined odds
      } else {
        totalOdds = calculateCombinedOdds(selections.map((s) => lockedOdds[s.id]));
        potentialWin = calculatePotentialWin(stake, totalOdds.toNumber());
      }

      // 8. Risk assessment
      const riskCheck = await this.riskService.assessBet(
        userId,
        stake,
        totalOdds.toNumber(),
        selections[0].market.id,
        potentialWin.toNumber(),
      );

      if (!riskCheck.approved) {
        throw new BadRequestException(`Bet rejected: ${riskCheck.reason}`);
      }

      // 9. Reserve funds atomically
      await this.walletService.reserveFunds(userId, stake, 'pre-check');

      // 10. Create bet in DB + reserve in wallet atomically
      const betRef = generateBetRef();
      const bet = await this.prisma.executeTransaction(async (tx) => {
        // Final wallet deduction
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) {
          throw new NotFoundException("wallet not found.");
        }
        // const available = balance.sub(reservedBalance.sub(stake)); // already reserved above

        const balance = new Decimal(wallet.balance.toString());
        const reservedBalance = new Decimal(wallet.reservedBalance.toString());
        const stakeDecimal = new Decimal(stake);

        if (reservedBalance.lt(stakeDecimal)) {
          throw new BadRequestException('Reserved balance is insufficient');
        }

        // Create bet record
        const newBet = await tx.bet.create({
          data: {
            userId,
            betRef,
            type: betType as BetType,
            status: 'ACCEPTED' as BetStatus,
            stake,
            totalOdds: totalOdds.toDecimalPlaces(4).toNumber(),
            potentialWin: potentialWin.toDecimalPlaces(2).toNumber(),
            oddsChangePolicy: oddsChangePolicy || 'REJECT',
            systemBetDetails: betType === 'SYSTEM' ? { systemSize, combinations: selectionIds.length } : undefined,
            selections: {
              create: selections.map((sel) => ({
                selectionId: sel.id,
                marketId: sel.market.id,
                eventId: sel.market.event.id,
                odds: lockedOdds[sel.id],
              })),
            },
          },
          include: { selections: true },
        });

        // Confirm wallet deduction
        await tx.wallet.update({
          where: { userId },
          data: {
            balance: balance.sub(stake).toDecimalPlaces(2).toNumber(),
            reservedBalance: reservedBalance.sub(stake).toDecimalPlaces(2).toNumber(),
            version: { increment: 1 },
          },
        });

        // Transaction ledger entry
        await tx.transaction.updateMany({
          where: { referenceId: 'pre-check', userId, status: 'PENDING' },
          data: {
            referenceId: newBet.id,
            status: 'COMPLETED',
            balanceAfter: balance.sub(stake).toDecimalPlaces(2).toNumber(),
          },
        });

        return newBet;
      });

      // 11. Track exposure and risk profile
      await Promise.all([
        this.riskService.trackUserExposure(userId, potentialWin.toNumber()),
        this.marketService.updateMarketExposure(
          selections[0].market.id,
          potentialWin.toNumber(),
        ),
      ]);

      // 12. Release odds locks
      for (const lock of oddsLocks) {
        await this.oddsService.releaseOddsLock(lock.selectionId, lock.token);
      }

      // 13. Publish bet placed event
      await this.redis.publish('bet:placed', JSON.stringify({ betId: bet.id, userId, stake }));

      this.logger.log(`Bet placed: ${bet.betRef} by user ${userId}, stake=${stake}, odds=${totalOdds}`);
      return bet;
    } catch (err) {
      // Release odds locks on error
      for (const lock of oddsLocks) {
        await this.oddsService.releaseOddsLock(lock.selectionId, lock.token).catch(() => {});
      }
      // Release wallet reservation on error
      await this.walletService.releaseReservation(userId, stake, 'pre-check').catch(() => {});
      throw err;
    }
  }

  // ─── Get Bets ─────────────────────────────────────────────────────────────

  async getUserBets(
    userId: string,
    status?: BetStatus,
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;
    const where: any = { userId };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.bet.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          selections: {
            include: {
              selection: {
                include: { market: { include: { event: { include: { sport: true } } } } },
              },
            },
          },
        },
      }),
      this.prisma.bet.count({ where }),
    ]);

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async getBet(betId: string, userId?: string) {
    const where: any = { id: betId };
    if (userId) where.userId = userId;

    const bet = await this.prisma.bet.findFirst({
      where,
      include: {
        selections: {
          include: {
            selection: {
              include: { market: { include: { event: { include: { sport: true } } } } },
            },
          },
        },
        cashouts: true,
      },
    });
    if (!bet) throw new NotFoundException('Bet not found');
    return bet;
  }

  async getBetByRef(betRef: string) {
    const bet = await this.prisma.bet.findUnique({
      where: { betRef },
      include: { selections: { include: { selection: true } } },
    });
    if (!bet) throw new NotFoundException('Bet not found');
    return bet;
  }

  // ─── Cancel Bet ───────────────────────────────────────────────────────────

  async cancelBet(betId: string, userId: string) {
    const bet = await this.getBet(betId, userId);

    if (bet.status !== 'PENDING' && bet.status !== 'ACCEPTED') {
      throw new BadRequestException(`Cannot cancel bet with status: ${bet.status}`);
    }

    // Check if any event has started
    for (const sel of bet.selections) {
      if (sel.selection.market.event?.startTime < new Date()) {
        throw new BadRequestException('Cannot cancel bet after event has started');
      }
    }

    await this.prisma.executeTransaction(async (tx) => {
      await tx.bet.update({
        where: { id: betId },
        data: { status: 'CANCELLED' },
      });

      // Refund stake
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        throw new NotFoundException("wallet not found");
      }
      const balance = new Decimal(wallet.balance.toString());
      const stake = new Decimal(bet.stake.toString());

      await tx.wallet.update({
        where: { userId },
        data: {
          balance: balance.add(stake).toDecimalPlaces(2).toNumber(),
          version: { increment: 1 },
        },
      });

      await tx.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: 'BET_REFUND',
          status: 'COMPLETED',
          amount: stake.toDecimalPlaces(2).toNumber(),
          balanceBefore: balance.toDecimalPlaces(2).toNumber(),
          balanceAfter: balance.add(stake).toDecimalPlaces(2).toNumber(),
          referenceId: betId,
          referenceType: 'BET_CANCEL',
          description: `Refund for cancelled bet ${bet.betRef}`,
        },
      });
    });

    await this.riskService.releaseUserExposure(
      userId,
      parseFloat(bet.potentialWin.toString()),
    );

    return this.getBet(betId);
  }

  // ─── Settle Bet ───────────────────────────────────────────────────────────

  async settleBet(betId: string) {
    const bet = await this.prisma.bet.findUnique({
      where: { id: betId },
      include: {
        selections: {
          include: { selection: { include: { market: true } } },
        },
      },
    });

    if (!bet) throw new NotFoundException('Bet not found');
    if (bet.status !== 'ACCEPTED') {
      throw new BadRequestException(`Bet ${betId} is not in ACCEPTED state (current: ${bet.status})`);
    }

    // Check all markets are settled
    for (const sel of bet.selections) {
      if (sel.selection.market.status !== 'SETTLED') {
        throw new BadRequestException(
          `Market ${sel.selection.market.id} is not settled yet`,
        );
      }
    }

    // Determine win/loss
    let isWinner = true;
    let voidCount = 0;

    for (const sel of bet.selections) {
      const selResult = sel.selection.isWinner;
      if (selResult === null || selResult === undefined) {
        // Selection voided
        voidCount++;
      } else if (!selResult) {
        isWinner = false;
        break;
      }
    }

    // Handle void - recalculate odds excluding voided selections
    let actualOdds = new Decimal(bet.totalOdds.toString());
    if (voidCount > 0 && isWinner) {
      const validSelections = bet.selections.filter(
        (s) => s.selection.isWinner !== null && s.selection.isWinner !== undefined,
      );
      if (validSelections.length === 0) {
        // All voided -> full refund
        return this._voidBet(bet, 'All selections voided');
      }
      actualOdds = calculateCombinedOdds(
        validSelections.map((s) => parseFloat(s.odds.toString())),
      );
    }

    const stake = new Decimal(bet.stake.toString());
    const actualWin = isWinner ? stake.mul(actualOdds) : new Decimal(0);

    await this.prisma.executeTransaction(async (tx) => {
      await tx.bet.update({
        where: { id: betId },
        data: {
          status: isWinner ? 'WON' : 'LOST',
          actualWin: actualWin.toDecimalPlaces(2).toNumber(),
          settledAt: new Date(),
        },
      });

      await tx.betSelection.updateMany({
        where: { betId },
        data: { isSettled: true },
      });

      if (isWinner && actualWin.gt(0)) {
        const wallet = await tx.wallet.findUnique({ where: { userId: bet.userId } });
        if (!wallet) {
          throw new NotFoundException('Unknown wallet');
        }
        const balance = new Decimal(wallet.balance.toString());

        await tx.wallet.update({
          where: { userId: bet.userId },
          data: {
            balance: balance.add(actualWin).toDecimalPlaces(2).toNumber(),
            version: { increment: 1 },
          },
        });

        await tx.transaction.create({
          data: {
            userId: bet.userId,
            walletId: wallet.id,
            type: 'BET_WIN',
            status: 'COMPLETED',
            amount: actualWin.toDecimalPlaces(2).toNumber(),
            balanceBefore: balance.toDecimalPlaces(2).toNumber(),
            balanceAfter: balance.add(actualWin).toDecimalPlaces(2).toNumber(),
            referenceId: betId,
            referenceType: 'BET_WIN',
            description: `Winnings for bet ${bet.betRef}`,
          },
        });
      }
    });

    // Update risk profile
    await this.riskService.updateRiskProfile(bet.userId, {
      stake: parseFloat(bet.stake.toString()),
      won: isWinner,
      winAmount: actualWin.toNumber(),
    });

    // Release exposure tracking
    await this.riskService.releaseUserExposure(
      bet.userId,
      parseFloat(bet.potentialWin.toString()),
    );

    await this.redis.publish(
      'bet:settled',
      JSON.stringify({ betId, userId: bet.userId, won: isWinner, amount: actualWin }),
    );

    this.logger.log(`Bet settled: ${bet.betRef} - ${isWinner ? 'WON' : 'LOST'}`);
    return this.getBet(betId);
  }

  private async _voidBet(bet: any, reason: string) {
    await this.prisma.executeTransaction(async (tx) => {
      await tx.bet.update({
        where: { id: bet.id },
        data: { status: 'VOID', voidedAt: new Date(), voidReason: reason },
      });

      // Refund stake
      const wallet = await tx.wallet.findUnique({ where: { userId: bet.userId } });
      if (!wallet) {
        throw new NotFoundException('Unknown wallet');
      }
      const balance = new Decimal(wallet.balance.toString());
      const stake = new Decimal(bet.stake.toString());

      await tx.wallet.update({
        where: { userId: bet.userId },
        data: {
          balance: balance.add(stake).toDecimalPlaces(2).toNumber(),
          version: { increment: 1 },
        },
      });

      await tx.transaction.create({
        data: {
          userId: bet.userId,
          walletId: wallet.id,
          type: 'BET_REFUND',
          status: 'COMPLETED',
          amount: stake.toDecimalPlaces(2).toNumber(),
          balanceBefore: balance.toDecimalPlaces(2).toNumber(),
          balanceAfter: balance.add(stake).toDecimalPlaces(2).toNumber(),
          referenceId: bet.id,
          referenceType: 'BET_VOID',
          description: `Void refund: ${reason}`,
        },
      });
    });

    return this.getBet(bet.id);
  }

  // ─── Bulk settle by market ────────────────────────────────────────────────

  async settleBetsByMarket(marketId: string) {
    const bets = await this.prisma.bet.findMany({
      where: {
        status: 'ACCEPTED',
        selections: { some: { marketId } },
      },
    });

    const results = await Promise.allSettled(
      bets.map((bet) => this.settleBet(bet.id)),
    );

    const settled = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    this.logger.log(`Market ${marketId} settle: ${settled} settled, ${failed} failed`);
    return { settled, failed, total: bets.length };
  }
}
