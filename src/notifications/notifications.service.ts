// src/notifications/notifications.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { RedisService } from '@redis/redis.service';

export type NotificationType =
  | 'BET_ACCEPTED'
  | 'BET_WON'
  | 'BET_LOST'
  | 'BET_VOID'
  | 'BET_CASHED_OUT'
  | 'DEPOSIT_SUCCESS'
  | 'WITHDRAWAL_SUCCESS'
  | 'ODDS_CHANGED'
  | 'MARKET_SUSPENDED'
  | 'ACCOUNT_LOCKED'
  | 'SYSTEM';

export interface NotificationPayload {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async send(payload: NotificationPayload) {
    // Publish to Redis so WebSocket gateway can pick it up
    await this.redis.publish(
      `notification:${payload.userId}`,
      JSON.stringify(payload),
    );

    this.logger.debug(`Notification sent: [${payload.type}] -> ${payload.userId}`);
    return payload;
  }

  async notifyBetPlaced(userId: string, betRef: string, stake: number) {
    return this.send({
      userId,
      type: 'BET_ACCEPTED',
      title: 'Bet Placed Successfully',
      body: `Your bet ${betRef} for $${stake} has been accepted.`,
      metadata: { betRef, stake },
    });
  }

  async notifyBetWon(userId: string, betRef: string, winAmount: number) {
    return this.send({
      userId,
      type: 'BET_WON',
      title: '🎉 You Won!',
      body: `Bet ${betRef} won! $${winAmount.toFixed(2)} has been credited to your wallet.`,
      metadata: { betRef, winAmount },
    });
  }

  async notifyBetLost(userId: string, betRef: string) {
    return this.send({
      userId,
      type: 'BET_LOST',
      title: 'Bet Settled',
      body: `Bet ${betRef} has been settled as a loss.`,
      metadata: { betRef },
    });
  }

  async notifyCashout(userId: string, betRef: string, amount: number) {
    return this.send({
      userId,
      type: 'BET_CASHED_OUT',
      title: 'Cashout Successful',
      body: `Cashed out $${amount.toFixed(2)} from bet ${betRef}.`,
      metadata: { betRef, amount },
    });
  }

  async notifyOddsChange(
    userId: string,
    selectionName: string,
    oldOdds: number,
    newOdds: number,
  ) {
    const direction = newOdds > oldOdds ? '📈' : '📉';
    return this.send({
      userId,
      type: 'ODDS_CHANGED',
      title: 'Odds Changed',
      body: `${direction} ${selectionName}: ${oldOdds} → ${newOdds}`,
      metadata: { selectionName, oldOdds, newOdds },
    });
  }
}
