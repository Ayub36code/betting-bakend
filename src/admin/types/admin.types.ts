// src/admin/types/admin.types.ts
import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

@ObjectType()
class UserStats {
  @Field(() => Int) total: number;
  @Field(() => Int) active: number;
}

@ObjectType()
class BetStats {
  @Field(() => Int) today: number;
  @Field(() => Int) open: number;
}

@ObjectType()
class FinancialStats {
  @Field(() => Float) stakedToday: number;
  @Field(() => Float) wonToday: number;
  @Field(() => Float) ggr: number;
  @Field() ggrMargin: string;
}

@ObjectType()
class MarketStats {
  @Field(() => Int) open: number;
}

@ObjectType()
class EventStats {
  @Field(() => Int) live: number;
}

@ObjectType()
export class DashboardStatsType {
  @Field(() => UserStats) users: UserStats;
  @Field(() => BetStats) bets: BetStats;
  @Field(() => FinancialStats) financials: FinancialStats;
  @Field(() => MarketStats) markets: MarketStats;
  @Field(() => EventStats) events: EventStats;
  @Field(() => Int) pendingWithdrawals: number;
}

@ObjectType()
export class SystemConfigType {
  @Field() id: string;
  @Field() key: string;
  @Field() category: string;
  @Field({ nullable: true }) updatedBy?: string;
  @Field() createdAt: Date;
  @Field() updatedAt: Date;
}

@ObjectType()
export class AuditLogType {
  @Field() id: string;
  @Field({ nullable: true }) userId?: string;
  @Field() action: string;
  @Field() resource: string;
  @Field({ nullable: true }) resourceId?: string;
  @Field({ nullable: true }) ipAddress?: string;
  @Field() createdAt: Date;
}

@ObjectType()
export class AuditLogListResponse {
  @Field(() => [AuditLogType]) data: AuditLogType[];
  @Field(() => Int) total: number;
  @Field(() => Int) page: number;
  @Field(() => Int) totalPages: number;
}

@ObjectType()
export class ExposureReportItem {
  @Field() id: string;
  @Field() name: string;
  @Field(() => Float) currentExposure: number;
  @Field(() => Float) maxExposure: number;
  @Field() exposurePercentage: string;
}
