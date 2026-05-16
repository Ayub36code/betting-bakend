// src/risk/risk.resolver.ts
import { Resolver, Query, Mutation, Args, Int, ObjectType, Field, ID, Float } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { RiskService } from './risk.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';

@ObjectType()
class RiskProfileType {
  @Field(() => ID) id: string;
  @Field() userId: string;
  @Field() riskScore: number;
  @Field() totalBets: number;
  @Field(() => Float) totalStaked: number;
  @Field(() => Float) totalWon: number;
  @Field(() => Float) winRate: number;
  @Field() flaggedForReview: boolean;
  @Field({ nullable: true }) reviewReason?: string;
  @Field() lastUpdated: Date;
}

@ObjectType()
class FlaggedUsersResponse {
  @Field(() => [RiskProfileType]) data: RiskProfileType[];
  @Field() total: number;
  @Field() page: number;
  @Field() totalPages: number;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Resolver()
export class RiskResolver {
  constructor(private riskService: RiskService) {}

  @Query(() => RiskProfileType)
  async myRiskProfile(@CurrentUser() user: any) {
    return this.riskService.getOrCreateRiskProfile(user.id);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Query(() => FlaggedUsersResponse)
  async flaggedUsers(
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
  ) {
    return this.riskService.getFlaggedUsers(page, limit);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Mutation(() => Boolean)
  async clearReviewFlag(@Args('userId') userId: string) {
    await this.riskService.clearReviewFlag(userId);
    return true;
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Mutation(() => Boolean)
  async flagUserForReview(
    @Args('userId') userId: string,
    @Args('reason') reason: string,
  ) {
    await this.riskService.flagForReview(userId, reason);
    return true;
  }
}
