// src/prisma/prisma.service.ts
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('✅ Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }

  /**
   * Execute a function within a transaction with retry logic
   */
  async executeTransaction<T>(
    fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    let retries = 0;
    while (retries < maxRetries) {
      try {
        return await this.$transaction(fn, {
          maxWait: 5000,
          timeout: 15000,
          isolationLevel: 'Serializable',
        });
      } catch (err: any) {
        // P2034 = transaction conflict - retry
        if (err.code === 'P2034' && retries < maxRetries - 1) {
          retries++;
          await new Promise((r) => setTimeout(r, 50 * retries));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Transaction failed after maximum retries');
  }

  /**
   * Paginate helper
   */
  paginate(page: number, limit: number) {
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;
    return { take, skip };
  }
}
