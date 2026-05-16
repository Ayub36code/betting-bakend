// src/auth/auth.resolver.ts
import { Resolver, Mutation, Args, Context, Query } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterInput } from './dto/register.input';
import { LoginInput } from './dto/login.input';
import { AuthResponse, LogoutResponse, TokenResponse } from './types/auth.types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, Public } from '../common/decorators';

@Resolver()
export class AuthResolver {
  constructor(private auth: AuthService) {}

  @Public()
  @Mutation(() => AuthResponse)
  async register(@Args('input') input: RegisterInput): Promise<AuthResponse> {
    return await this.auth.register(input) as any;
  }

  @Public()
  @Mutation(() => AuthResponse)
  async login(
    @Args('input') input: LoginInput,
    @Context() ctx: any,
  ): Promise<AuthResponse> {
    const ip = ctx.req?.ip;
    const ua = ctx.req?.headers?.['user-agent'];
    return await this.auth.login(input, ip, ua) as any;
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => LogoutResponse)
  async logout(
    @CurrentUser() user: any,
    @Context() ctx: any,
  ): Promise<LogoutResponse> {
    const token = ctx.req?.headers?.authorization?.replace('Bearer ', '');
    return this.auth.logout(user.id, token);
  }

  @Public()
  @Mutation(() => TokenResponse)
  async refreshToken(@Args('refreshToken') refreshToken: string): Promise<TokenResponse> {
    return this.auth.refreshTokens(refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Query(() => Boolean)
  async me(@CurrentUser() user: any): Promise<boolean> {
    return !!user;
  }
}
