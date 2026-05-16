# 🎰 Betting App — Backend

Production-grade betting platform backend built with **NestJS + TypeScript + GraphQL + WebSocket + Redis + Prisma**.

---

## 🗂 Project Structure

```
src/
├── main.ts                        # Bootstrap, global middleware
├── app.module.ts                  # Root module, wires everything together
│
├── prisma/                        # Prisma ORM client & transaction helpers
│   ├── prisma.service.ts          # PrismaClient + executeTransaction() + retry
│   └── prisma.module.ts
│
├── redis/                         # Redis service (cache, locks, pub/sub)
│   ├── redis.service.ts           # Distributed locks, atomic ops, pub/sub bridge
│   └── redis.module.ts
│
├── auth/                          # Authentication & session management
│   ├── auth.service.ts            # Register, login, logout, refresh, brute-force protection
│   ├── auth.resolver.ts           # GraphQL mutations: register, login, logout, refresh
│   ├── strategies/
│   │   ├── jwt.strategy.ts        # Passport JWT strategy
│   │   └── local.strategy.ts      # Passport local strategy
│   ├── dto/
│   │   ├── register.input.ts
│   │   └── login.input.ts
│   └── types/auth.types.ts
│
├── user/                          # User profiles, limits, self-exclusion
│   ├── user.service.ts
│   ├── user.resolver.ts
│   ├── dto/update-profile.input.ts
│   └── types/user.types.ts
│
├── wallet/                        # Wallet ledger — atomic credit/debit/reserve
│   ├── wallet.service.ts          # credit(), debit(), reserveFunds(), rollback()
│   ├── wallet.resolver.ts
│   └── types/wallet.types.ts
│
├── market/                        # Sports, events, markets, selections
│   ├── market.service.ts          # CRUD, settlement, suspend/resume, exposure
│   ├── market.resolver.ts         # GraphQL queries + admin mutations + subscriptions
│   ├── dto/
│   │   ├── create-event.input.ts
│   │   └── create-market.input.ts
│   └── types/market.types.ts
│
├── odds/                          # Odds engine — locking, history, conversion
│   ├── odds.service.ts            # lockOdds(), validateOddsAtPlacement(), updateOdds()
│   ├── odds.resolver.ts           # Subscriptions for live odds updates
│   └── types/odds.types.ts
│
├── bet/                           # Core betting engine
│   ├── bet.service.ts             # placeBet(), settleBet(), cancelBet(), system bets
│   ├── bet.resolver.ts
│   ├── dto/place-bet.input.ts
│   └── types/bet.types.ts
│
├── cashout/                       # Full & partial cashout
│   ├── cashout.service.ts         # Live cashout value, execute cashout, lock protection
│   ├── cashout.resolver.ts
│   └── types/cashout.types.ts
│
├── booking/                       # Booking codes (share bets by code)
│   ├── booking.service.ts         # Create/load booking codes with live odds refresh
│   ├── booking.resolver.ts
│   └── types/booking.types.ts
│
├── risk/                          # Risk management & exposure control
│   ├── risk.service.ts            # assessBet(), trackExposure(), risk scoring, flagging
│   ├── risk.resolver.ts
│   └── (types inline)
│
├── admin/                         # Admin panel — dashboard, reports, config
│   ├── admin.service.ts           # Dashboard stats, GGR, financial reports, audit logs
│   ├── admin.resolver.ts
│   └── types/admin.types.ts
│
├── notifications/                 # Real-time notifications via Redis pub/sub
│   ├── notifications.service.ts
│   └── notifications.module.ts
│
├── websocket/                     # socket.io Gateway
│   ├── websocket.gateway.ts       # WS hub, Redis→WS bridge, rooms per event/market/user
│   └── websocket.module.ts
│
└── common/
    ├── decorators/index.ts        # @CurrentUser, @Roles, @Public
    ├── guards/
    │   ├── jwt-auth.guard.ts
    │   └── roles.guard.ts
    ├── filters/http-exception.filter.ts
    ├── interceptors/transform.interceptor.ts
    ├── enums/index.ts
    └── utils/index.ts             # Odds math, bet refs, booking codes, system bets

prisma/
├── schema.prisma                  # Full DB schema (17 models)
└── seed.ts                        # Dev seed data

docker-compose.yml                 # Postgres + Redis + app + Redis Commander
Dockerfile
.env.example
```

---

## ✨ Features

| Feature | Description |
|---|---|
| **Authentication** | JWT access + refresh tokens, brute-force lockout, session tracking |
| **Wallet Ledger** | Full double-entry ledger — every debit/credit recorded with balance snapshots |
| **Bet Placement** | Single, multi (accumulator), and system bets with per-user locking |
| **Odds Locking** | Distributed Redis lock per selection during placement; configurable change policy |
| **Bet Validation** | Market open, event status, cutoff time, selection suspension, duplicate events |
| **Multi-bets** | Combined odds, event uniqueness check, system bet combinations |
| **Cashout** | Full & partial cashout with live odds, configurable margin, per-bet lock |
| **Exposure Control** | Per-user & per-market exposure tracked in Redis, enforced pre-placement |
| **Risk Management** | Risk scoring, daily loss limits, high-odds flagging, manual review queue |
| **Rollback Logic** | Admin can roll back any completed transaction with full audit trail |
| **Atomic Transactions** | `Serializable` Prisma transactions with P2034 retry logic |
| **Booking Codes** | Create/share bet slips by code; codes refresh live odds on load |
| **Settlement** | Auto-settle bets when market is settled; handles void + partial void |
| **Admin Panel** | Dashboard stats, GGR, financial reports, exposure reports, audit logs |
| **System Config** | DB-backed key/value config (min stake, cashout margin, etc.) |
| **Real-time** | socket.io gateway bridged from Redis pub/sub; rooms per event/market/user |
| **GraphQL Subscriptions** | `graphql-ws` subscriptions for odds, scores, bet results |
| **Scheduled Jobs** | Expire bookings, reset daily/weekly exposure counters |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose

### 1 — Clone & install

```bash
git clone <repo>
cd betting-app
npm install
```

### 2 — Start infrastructure

```bash
docker-compose up -d postgres redis
```

### 3 — Configure environment

```bash
cp .env
# Edit DATABASE_URL, JWT_SECRET, etc.
```

### 4 — Run migrations & seed

```bash
npm run prisma:migrate
npm run prisma:seed
```

### 5 — Start the app

```bash
npm run start:dev
```

GraphQL Playground → http://localhost:3000/graphql

---

## 🔑 Auth Flow

```
POST /graphql
mutation Login {
  login(input: { identifier: "user@betting.com", password: "User@123!" }) {
    accessToken
    refreshToken
    user { id email role }
  }
}
```

Pass `Authorization: Bearer <accessToken>` on all protected requests.

---

## 📡 WebSocket Events

Connect to `ws://localhost:3000/betting`

```js
// Auth
const socket = io('http://localhost:3000/betting', {
  auth: { token: '<accessToken>' }
});

// Subscribe to a live event
socket.emit('subscribe:event', { eventId: '<id>' });

// Listen for odds updates
socket.on('odds:updated', ({ selectionId, oldOdds, newOdds }) => { ... });

// Listen for score changes
socket.on('score:updated', ({ eventId, score }) => { ... });

// Personal bet results
socket.on('bet:settled', ({ betId, won, amount }) => { ... });
```

---

## 💰 Bet Placement Flow

```
1. Client → placeBet(selectionIds, stake, betType)
2. Server acquires per-user Redis lock
3. Validates each selection (open, not suspended, cutoff)
4. Checks no duplicate events in multi-bet
5. Locks odds per selection (Redis distributed lock)
6. Validates odds haven't moved beyond policy
7. Calculates combined odds + potential win
8. Risk check (exposure, daily limit, risk score)
9. Reserves funds in wallet (reservedBalance++)
10. Creates bet + confirms wallet deduction atomically (Serializable tx)
11. Updates market exposure
12. Releases odds locks
13. Publishes bet:placed → Redis → WebSocket
```

---

## 🏗 Key Design Decisions

- **Serializable transactions** — prevents race conditions on wallet balance
- **Redis distributed locks** — prevents double-bet submissions and concurrent cashouts
- **Optimistic locking** (`version` field) — detects stale wallet reads
- **Idempotency keys** — deduplicates transactions (safe for retries)
- **Odds lock TTL = 30s** — holds price for user during checkout flow
- **P2034 retry** — handles Prisma transaction conflicts automatically
- **Redis pub/sub → socket.io bridge** — decouples services from WebSocket layer

---

## 🔐 Roles

| Role | Access |
|---|---|
| `USER` | Place bets, cashout, wallet, profile |
| `OPERATOR` | Update odds, suspend/resume markets, settle |
| `ADMIN` | All above + user management, financial reports |
| `SUPER_ADMIN` | All above + rollbacks, system config, risk overrides |
