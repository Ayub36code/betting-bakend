// prisma/seed.ts
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Admin user
  const adminHash = await bcrypt.hash('Admin@123!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@betting.com' },
    update: {},
    create: {
      email: 'admin@betting.com',
      username: 'admin',
      passwordHash: adminHash,
      role: Role.SUPER_ADMIN,
      isVerified: true,
      kycVerified: true,
      firstName: 'Super',
      lastName: 'Admin',
      wallet: { create: { balance: 0, currency: 'USD' } },
    },
  });

  // Test user
  const userHash = await bcrypt.hash('User@123!', 12);
  const user = await prisma.user.upsert({
    where: { email: 'user@betting.com' },
    update: {},
    create: {
      email: 'user@betting.com',
      username: 'testuser',
      passwordHash: userHash,
      role: Role.USER,
      isVerified: true,
      kycVerified: true,
      firstName: 'Test',
      lastName: 'User',
      wallet: { create: { balance: 1000, currency: 'USD' } },
    },
  });

  // Sports
  const football = await prisma.sport.upsert({
    where: { slug: 'football' },
    update: {},
    create: { name: 'Football', slug: 'football', sortOrder: 1 },
  });

  const basketball = await prisma.sport.upsert({
    where: { slug: 'basketball' },
    update: {},
    create: { name: 'Basketball', slug: 'basketball', sortOrder: 2 },
  });

  // Event
  const event = await prisma.event.create({
    data: {
      sportId: football.id,
      name: 'Manchester United vs Arsenal',
      slug: 'man-utd-vs-arsenal',
      homeTeam: 'Manchester United',
      awayTeam: 'Arsenal',
      startTime: new Date(Date.now() + 3600 * 1000),
      status: 'UPCOMING',
    },
  });

  // Markets
  const market = await prisma.market.create({
    data: {
      eventId: event.id,
      name: 'Match Winner',
      type: 'MATCH_WINNER',
      status: 'OPEN',
      selections: {
        create: [
          { name: 'Manchester United', code: 'H', odds: 2.10 },
          { name: 'Draw', code: 'D', odds: 3.40 },
          { name: 'Arsenal', code: 'A', odds: 3.20 },
        ],
      },
    },
  });

  // System configs
  await prisma.systemConfig.createMany({
    skipDuplicates: true,
    data: [
      { key: 'MIN_BET_AMOUNT', value: 1, category: 'BETTING' },
      { key: 'MAX_BET_AMOUNT', value: 10000, category: 'BETTING' },
      { key: 'MAX_PAYOUT', value: 500000, category: 'BETTING' },
      { key: 'MAX_MULTI_LEGS', value: 20, category: 'BETTING' },
      { key: 'CASHOUT_ENABLED', value: true, category: 'CASHOUT' },
      { key: 'CASHOUT_MARGIN', value: 0.05, category: 'CASHOUT' },
      { key: 'BOOKING_CODE_EXPIRY_HOURS', value: 24, category: 'BOOKING' },
      { key: 'ODDS_CHANGE_TOLERANCE', value: 0.05, category: 'ODDS' },
    ],
  });

  console.log('✅ Seed complete');
  console.log(`Admin: admin@betting.com / Admin@123!`);
  console.log(`User: user@betting.com / User@123!`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
