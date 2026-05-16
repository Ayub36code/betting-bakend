// src/wallet/wallet.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { RedisService } from '@redis/redis.service';
import Decimal from 'decimal.js';
import { TransactionType } from '@prisma/client';
import { generateIdempotencyKey } from '@common/utils';

interface CreditDebitOptions {
  userId: string;
  amount: number;
  type: TransactionType;
  referenceId?: string;
  referenceType?: string;
  description?: string;
  metadata?: any;
  idempotencyKey?: string;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async getBalance(userId: string) {
    const wallet = await this.getWallet(userId);
    return {
      balance: wallet.balance,
      bonusBalance: wallet.bonusBalance,
      reservedBalance: wallet.reservedBalance,
      availableBalance: new Decimal(wallet.balance.toString())
        .sub(wallet.reservedBalance.toString())
        .toNumber(),
      currency: wallet.currency,
    };
  }

  /**
   * Credit funds - atomically add money to wallet
   */
  async credit(opts: CreditDebitOptions) {
    const iKey = opts.idempotencyKey || generateIdempotencyKey();

    // Idempotency check
    const existing = await this.prisma.transaction.findUnique({
      where: { idempotencyKey: iKey },
    });
    if (existing) {
      this.logger.warn(`Duplicate transaction: ${iKey}`);
      return existing;
    }

    return this.prisma.executeTransaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: opts.userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const balanceBefore = new Decimal(wallet.balance.toString());
      const amount = new Decimal(opts.amount);
      const balanceAfter = balanceBefore.add(amount);

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: balanceAfter.toDecimalPlaces(2).toNumber(),
          version: { increment: 1 },
        },
      });

      const txn = await tx.transaction.create({
        data: {
          userId: opts.userId,
          walletId: wallet.id,
          type: opts.type,
          status: 'COMPLETED',
          amount: amount.toDecimalPlaces(2).toNumber(),
          balanceBefore: balanceBefore.toDecimalPlaces(2).toNumber(),
          balanceAfter: balanceAfter.toDecimalPlaces(2).toNumber(),
          referenceId: opts.referenceId,
          referenceType: opts.referenceType,
          description: opts.description,
          metadata: opts.metadata,
          idempotencyKey: iKey,
        },
      });

      this.logger.log(`Credit ${opts.amount} to user ${opts.userId} [${opts.type}]`);
      return txn;
    });
  }

  /**
   * Debit funds - atomically remove money from wallet
   */
  async debit(opts: CreditDebitOptions) {
    const iKey = opts.idempotencyKey || generateIdempotencyKey();

    const existing = await this.prisma.transaction.findUnique({
      where: { idempotencyKey: iKey },
    });
    if (existing) {
      this.logger.warn(`Duplicate transaction: ${iKey}`);
      return existing;
    }

    return this.prisma.executeTransaction(async (tx) => {
      // Lock wallet row for update
      const wallet = await tx.wallet.findUnique({ where: { userId: opts.userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const balanceBefore = new Decimal(wallet.balance.toString());
      const amount = new Decimal(opts.amount);
      const available = balanceBefore.sub(wallet.reservedBalance.toString());

      if (available.lt(amount)) {
        throw new BadRequestException(
          `Insufficient balance. Available: ${available.toFixed(2)}, Required: ${amount.toFixed(2)}`,
        );
      }

      const balanceAfter = balanceBefore.sub(amount);

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: balanceAfter.toDecimalPlaces(2).toNumber(),
          version: { increment: 1 },
        },
      });

      const txn = await tx.transaction.create({
        data: {
          userId: opts.userId,
          walletId: wallet.id,
          type: opts.type,
          status: 'COMPLETED',
          amount: amount.neg().toDecimalPlaces(2).toNumber(),
          balanceBefore: balanceBefore.toDecimalPlaces(2).toNumber(),
          balanceAfter: balanceAfter.toDecimalPlaces(2).toNumber(),
          referenceId: opts.referenceId,
          referenceType: opts.referenceType,
          description: opts.description,
          metadata: opts.metadata,
          idempotencyKey: iKey,
        },
      });

      this.logger.log(`Debit ${opts.amount} from user ${opts.userId} [${opts.type}]`);
      return txn;
    });
  }

  /**
   * Reserve funds for a pending bet (move to reservedBalance)
   */
  async reserveFunds(userId: string, amount: number, betId: string) {
    return this.prisma.executeTransaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const balance = new Decimal(wallet.balance.toString());
      const reserved = new Decimal(wallet.reservedBalance.toString());
      const amountD = new Decimal(amount);
      const available = balance.sub(reserved);

      if (available.lt(amountD)) {
        throw new BadRequestException(
          `Insufficient balance. Available: ${available.toFixed(2)}`,
        );
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          reservedBalance: reserved.add(amountD).toDecimalPlaces(2).toNumber(),
          version: { increment: 1 },
        },
      });

      // Record reservation transaction
      await tx.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: 'BET_PLACEMENT',
          status: 'PENDING',
          amount: amountD.neg().toDecimalPlaces(2).toNumber(),
          balanceBefore: balance.toDecimalPlaces(2).toNumber(),
          balanceAfter: balance.toDecimalPlaces(2).toNumber(),
          referenceId: betId,
          referenceType: 'BET',
          description: `Stake reserved for bet ${betId}`,
          idempotencyKey: `reserve:${betId}`,
        },
      });
    });
  }

  /**
   * Confirm bet deduction - remove from both balance AND reservation
   */
  async confirmBetDeduction(userId: string, amount: number, betId: string) {
    return this.prisma.executeTransaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const balance = new Decimal(wallet.balance.toString());
      const reserved = new Decimal(wallet.reservedBalance.toString());
      const amountD = new Decimal(amount);

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: balance.sub(amountD).toDecimalPlaces(2).toNumber(),
          reservedBalance: reserved.sub(amountD).toDecimalPlaces(2).toNumber(),
          version: { increment: 1 },
        },
      });

      // Update pending transaction to completed
      await tx.transaction.updateMany({
        where: { referenceId: betId, status: 'PENDING', type: 'BET_PLACEMENT' },
        data: {
          status: 'COMPLETED',
          balanceAfter: balance.sub(amountD).toDecimalPlaces(2).toNumber(),
        },
      });
    });
  }

  /**
   * Release reservation (when bet is voided/cancelled before settlement)
   */
  async releaseReservation(userId: string, amount: number, betId: string) {
    return this.prisma.executeTransaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const reserved = new Decimal(wallet.reservedBalance.toString());
      const amountD = new Decimal(amount);

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          reservedBalance: Decimal.max(0, reserved.sub(amountD))
            .toDecimalPlaces(2)
            .toNumber(),
          version: { increment: 1 },
        },
      });

      await tx.transaction.updateMany({
        where: { referenceId: betId, status: 'PENDING', type: 'BET_PLACEMENT' },
        data: { status: 'ROLLED_BACK', rolledBackAt: new Date() },
      });
    });
  }

  /**
   * Rollback a completed transaction (admin action)
   */
  async rollback(transactionId: string, adminId: string, reason: string) {
    return this.prisma.executeTransaction(async (tx) => {
      const originalTx = await tx.transaction.findUnique({
        where: { id: transactionId },
        include: { wallet: true },
      });

      if (!originalTx) throw new NotFoundException('Transaction not found');
      if (originalTx.status === 'ROLLED_BACK') {
        throw new ConflictException('Transaction already rolled back');
      }

      const wallet = originalTx.wallet;
      const originalAmount = new Decimal(originalTx.amount.toString());
      const currentBalance = new Decimal(wallet.balance.toString());
      // Reverse: if original was credit (+), rollback is debit (-) and vice versa
      const reversalAmount = originalAmount.neg();
      const newBalance = currentBalance.add(reversalAmount);

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: newBalance.toDecimalPlaces(2).toNumber(),
          version: { increment: 1 },
        },
      });

      // Mark original as rolled back
      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: 'ROLLED_BACK', rolledBackAt: new Date() },
      });

      // Create reversal transaction
      const rollbackTx = await tx.transaction.create({
        data: {
          userId: originalTx.userId,
          walletId: wallet.id,
          type: 'ROLLBACK',
          status: 'COMPLETED',
          amount: reversalAmount.toDecimalPlaces(2).toNumber(),
          balanceBefore: currentBalance.toDecimalPlaces(2).toNumber(),
          balanceAfter: newBalance.toDecimalPlaces(2).toNumber(),
          referenceId: transactionId,
          referenceType: 'ROLLBACK',
          description: `Rollback of ${transactionId}: ${reason}`,
          metadata: { originalTxId: transactionId, adminId, reason },
          idempotencyKey: `rollback:${transactionId}`,
        },
      });

      this.logger.warn(`Transaction ${transactionId} rolled back by admin ${adminId}`);
      return rollbackTx;
    });
  }

  /**
   * Deposit (admin or payment gateway)
   */
  async deposit(userId: string, amount: number, reference: string) {
    if (amount <= 0) throw new BadRequestException('Deposit amount must be positive');
    return this.credit({
      userId,
      amount,
      type: 'DEPOSIT',
      referenceId: reference,
      referenceType: 'DEPOSIT',
      description: `Deposit of ${amount}`,
      idempotencyKey: `deposit:${reference}`,
    });
  }

  /**
   * Withdrawal request
   */
  async withdraw(userId: string, amount: number) {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    const wallet = await this.getWallet(userId);
    const available = new Decimal(wallet.balance.toString()).sub(wallet.reservedBalance.toString());
    if (available.lt(amount)) throw new BadRequestException('Insufficient balance');

    return this.debit({
      userId,
      amount,
      type: 'WITHDRAWAL',
      description: `Withdrawal of ${amount}`,
    });
  }

  /**
   * Get transaction ledger for user
   */
  async getLedger(userId: string, page = 1, limit = 20, type?: TransactionType) {
    const skip = (page - 1) * limit;
    const where: any = { userId };
    if (type) where.type = type;

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }
}
