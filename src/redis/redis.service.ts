// src/redis/redis.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;
  private subscriber: Redis;
  private publisher: Redis;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const options = {
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD') || undefined,
      db: this.config.get<number>('REDIS_DB', 0),
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      lazyConnect: false,
    };

    this.client = new Redis(options);
    this.subscriber = new Redis(options);
    this.publisher = new Redis(options);

    this.client.on('connect', () => this.logger.log('✅ Redis connected'));
    this.client.on('error', (err) => this.logger.error('Redis error', err));
  }

  async onModuleDestroy() {
    await this.client.quit();
    await this.subscriber.quit();
    await this.publisher.quit();
  }

  // ─── Key helpers ─────────────────────────────────────────────────────────

  keys = {
    oddsLock: (selectionId: string) => `odds:lock:${selectionId}`,
    userExposure: (userId: string) => `exposure:user:${userId}`,
    marketExposure: (marketId: string) => `exposure:market:${marketId}`,
    walletVersion: (walletId: string) => `wallet:version:${walletId}`,
    session: (token: string) => `session:${token}`,
    betLock: (betId: string) => `bet:lock:${betId}`,
    rateLimit: (userId: string, action: string) => `rate:${action}:${userId}`,
    cashoutLock: (betId: string) => `cashout:lock:${betId}`,
    pendingBets: (userId: string) => `pending:bets:${userId}`,
    oddsCache: (selectionId: string) => `odds:cache:${selectionId}`,
    bookingCode: (code: string) => `booking:${code}`,
  };

  // ─── Core operations ──────────────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(...keys: string[]): Promise<void> {
    await this.client.del(...keys);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async incrby(key: string, by: number): Promise<number> {
    return this.client.incrby(key, by);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.client.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.client.zadd(key, score, member);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrange(key, start, stop);
  }

  // ─── Distributed lock ─────────────────────────────────────────────────────

  async acquireLock(key: string, ttlMs = 5000): Promise<string | null> {
    const token = `${Date.now()}-${Math.random()}`;
    const result = await this.client.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await this.client.eval(script, 1, key, token);
    return result === 1;
  }

  // ─── Pub/Sub ──────────────────────────────────────────────────────────────

  async publish(channel: string, message: string): Promise<void> {
    await this.publisher.publish(channel, message);
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, msg) => {
      if (ch === channel) callback(msg);
    });
  }

  // ─── Atomic operations ────────────────────────────────────────────────────

  async atomicDecrIfPositive(key: string, amount: number): Promise<{ success: boolean; value: number }> {
    const script = `
      local current = tonumber(redis.call("get", KEYS[1]))
      if current == nil then return {0, 0} end
      if current >= tonumber(ARGV[1]) then
        local newVal = redis.call("incrbyfloat", KEYS[1], -tonumber(ARGV[1]))
        return {1, newVal}
      else
        return {0, current}
      end
    `;
    const [success, value] = (await this.client.eval(script, 1, key, amount)) as [number, string];
    return { success: success === 1, value: parseFloat(value) };
  }

  getClient(): Redis {
    return this.client;
  }
}
