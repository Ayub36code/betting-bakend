// src/user/user.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileInput } from './dto/update-profile.input';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { wallet: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phoneNumber: input.phoneNumber,
        timezone: input.timezone,
      },
    });
  }

  async selfExclude(userId: string, days: number) {
    if (days < 1 || days > 365 * 5) {
      throw new BadRequestException('Exclusion period must be 1-1825 days');
    }
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return this.prisma.user.update({
      where: { id: userId },
      data: { selfExcludedUntil: until },
    });
  }

  async setLimits(
    userId: string,
    limits: { maxBetAmount?: number; maxDailyLoss?: number },
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        maxBetAmount: limits.maxBetAmount,
        maxDailyLoss: limits.maxDailyLoss,
      },
    });
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        _count: { select: { bets: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getUserBettingStats(userId: string) {
    const [totalBets, wonBets, totalStaked, totalWon] = await Promise.all([
      this.prisma.bet.count({ where: { userId } }),
      this.prisma.bet.count({ where: { userId, status: 'WON' } }),
      this.prisma.bet.aggregate({
        where: { userId, status: { notIn: ['CANCELLED', 'VOID'] } },
        _sum: { stake: true },
      }),
      this.prisma.bet.aggregate({
        where: { userId, status: 'WON' },
        _sum: { actualWin: true },
      }),
    ]);

    return {
      totalBets,
      wonBets,
      lostBets: totalBets - wonBets,
      winRate: totalBets > 0 ? ((wonBets / totalBets) * 100).toFixed(2) : '0',
      totalStaked: totalStaked._sum.stake || 0,
      totalWon: totalWon._sum.actualWin || 0,
    };
  }

  // Admin methods
  async listUsers(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { wallet: true },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async toggleActive(userId: string, isActive: boolean) {
    return this.prisma.user.update({ where: { id: userId }, data: { isActive } });
  }
}
