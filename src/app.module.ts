// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { join } from 'path';

import { PrismaModule } from '@prisma/prisma.module';
import { RedisModule } from '@redis/redis.module';
import { AuthModule } from '@auth/auth.module';
import { UserModule } from '@user/user.module';
import { WalletModule } from '@wallet/wallet.module';
import { BetModule } from '@bet/bet.module';
import { OddsModule } from '@odds/odds.module';
import { MarketModule } from '@market/market.module';
import { CashoutModule } from './cashout/cashout.module';
import { AdminModule } from './admin/admin.module';
import { RiskModule } from './risk/risk.module';
import { BookingModule } from './booking/booking.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WebsocketModule } from './websocket/websocket.module';

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env'],
    }),

    // GraphQL
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      playground: true,
      introspection: true,
      subscriptions: {
        'graphql-ws': true,
        'subscriptions-transport-ws': true,
      },
      context: ({ req, res, connection }) => {
        if (connection) return { req: connection.context, res };
        return { req, res };
      },
      formatError: (error) => ({
        message: error.message,
        code: error.extensions?.code,
        path: error.path,
      }),
    }),

    // Throttle
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get('THROTTLE_TTL', 60) * 1000,
          limit: config.get('THROTTLE_LIMIT', 100),
        },
      ],
    }),

    // Scheduler
    ScheduleModule.forRoot(),

    // Bull Queue
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('BULL_REDIS_HOST', 'localhost'),
          port: config.get<number>('BULL_REDIS_PORT', 6379),
        },
      }),
    }),

    // Core modules
    PrismaModule,
    RedisModule,

    // Feature modules
    AuthModule,
    UserModule,
    WalletModule,
    BetModule,
    OddsModule,
    MarketModule,
    CashoutModule,
    AdminModule,
    RiskModule,
    BookingModule,
    NotificationsModule,
    WebsocketModule,
  ],
})
export class AppModule {}
