// src/user/user.resolver.ts
import {Resolver, Query, Mutation, Args, Int, Float} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { UserType, UserListResponse } from './types/user.types';
import { UpdateProfileInput } from './dto/update-profile.input';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, Roles } from '../common/decorators';
import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
class BettingStats {
  @Field() totalBets: number;
  @Field() wonBets: number;
  @Field() lostBets: number;
  @Field() winRate: string;
  @Field(() => Float)
  totalStaked: number;
  @Field(() => Float)
  totalWon: number;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Resolver(() => UserType)
export class UserResolver {
  constructor(private userService: UserService) {}

  @Query(() => UserType)
  async myProfile(@CurrentUser() user: any) {
    return this.userService.getProfile(user.id);
  }

  @Mutation(() => UserType)
  async updateProfile(
    @CurrentUser() user: any,
    @Args('input') input: UpdateProfileInput,
  ) {
    return this.userService.updateProfile(user.id, input);
  }

  @Mutation(() => UserType)
  async selfExclude(
    @CurrentUser() user: any,
    @Args('days', { type: () => Int }) days: number,
  ) {
    return this.userService.selfExclude(user.id, days);
  }

  @Query(() => BettingStats)
  async myBettingStats(@CurrentUser() user: any) {
    return this.userService.getUserBettingStats(user.id);
  }

  // Admin
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Query(() => UserListResponse)
  async adminListUsers(
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
    @Args('search', { nullable: true }) search?: string,
  ) {
    return this.userService.listUsers(page, limit, search);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Mutation(() => UserType)
  async adminToggleUserActive(
    @Args('userId') userId: string,
    @Args('isActive') isActive: boolean,
  ) {
    return this.userService.toggleActive(userId, isActive);
  }
}
