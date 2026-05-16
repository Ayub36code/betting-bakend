// src/admin/admin.resolver.ts
import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import {
  DashboardStatsType,
  SystemConfigType,
  AuditLogListResponse,
  ExposureReportItem,
} from './types/admin.types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, Roles } from '../common/decorators';
import { ObjectType, Field, Float } from '@nestjs/graphql';

@ObjectType()
class FinancialReport {
  @Field(() => Float) totalStaked: number;
  @Field(() => Float) totalPaidOut: number;
  @Field(() => Float) ggr: number;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Resolver()
export class AdminResolver {
  constructor(private adminService: AdminService) {}

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Query(() => DashboardStatsType)
  async adminDashboard() {
    return this.adminService.getDashboardStats();
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Query(() => [ExposureReportItem])
  async adminExposureReport() {
    return this.adminService.getExposureReport();
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Query(() => AuditLogListResponse)
  async adminAuditLogs(
    @Args('userId', { nullable: true }) userId?: string,
    @Args('resource', { nullable: true }) resource?: string,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number = 1,
    @Args('limit', { type: () => Int, defaultValue: 50 }) limit: number = 50,
  ) {
    return this.adminService.getAuditLogs(userId, resource, undefined, undefined, page, limit);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Query(() => [SystemConfigType])
  async adminSystemConfigs(
    @Args('category', { nullable: true }) category?: string,
  ) {
    return this.adminService.getSystemConfigs(category);
  }

  @Roles('SUPER_ADMIN')
  @Mutation(() => SystemConfigType)
  async adminSetSystemConfig(
    @CurrentUser() admin: any,
    @Args('key') key: string,
    @Args('value') value: string,
    @Args('category', { defaultValue: 'GENERAL' }) category: string,
  ) {
    let parsedValue: any;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      parsedValue = value;
    }
    return this.adminService.setSystemConfig(key, parsedValue, admin.id, category);
  }
}
