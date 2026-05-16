// src/websocket/websocket.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@redis/redis.service';
import { PrismaService } from '@prisma/prisma.service';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  namespace: '/betting',
  transports: ['websocket', 'polling'],
})
export class BettingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(BettingGateway.name);

  // Track connected users: userId -> Set<socketId>
  private userSockets = new Map<string, Set<string>>();
  // Track subscriptions: socketId -> Set<channels>
  private socketChannels = new Map<string, Set<string>>();

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private redis: RedisService,
    private prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('🔌 WebSocket Gateway initialized');
  }

  async onModuleInit() {
    // Subscribe to Redis pub/sub channels and broadcast to WS clients
    await this._subscribeToRedisChannels();
  }

  // ─── Connection / Auth ────────────────────────────────────────────────────

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (token) {
        const payload = this.jwt.verify(token, {
          secret: this.config.get('JWT_SECRET'),
        });
        client.data.userId = payload.sub;
        client.data.role = payload.role;

        // Track user -> socket mapping
        if (!this.userSockets.has(payload.sub)) {
          this.userSockets.set(payload.sub, new Set());
        }

        // Auto-join user-specific room
        client.join(`user:${payload.sub}`);
        this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
      } else {
        client.data.userId = null;
        this.logger.log(`Anonymous client connected: ${client.id}`);
      }

      this.socketChannels.set(client.id, new Set());
      client.emit('connected', { socketId: client.id, timestamp: Date.now() });
    } catch (err) {
      this.logger.warn(`Connection rejected: ${client.id} - ${err.message}`);
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      const sockets = this.userSockets.get(userId);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) this.userSockets.delete(userId);
      }
    }
    this.socketChannels.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // ─── Client Messages ──────────────────────────────────────────────────────

  @SubscribeMessage('subscribe:event')
  handleSubscribeEvent(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string },
  ) {
    const room = `event:${data.eventId}`;
    client.join(room);
    this.socketChannels.get(client.id)?.add(room);
    client.emit('subscribed', { channel: room });
    this.logger.debug(`${client.id} subscribed to ${room}`);
  }

  @SubscribeMessage('unsubscribe:event')
  handleUnsubscribeEvent(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string },
  ) {
    const room = `event:${data.eventId}`;
    client.leave(room);
    this.socketChannels.get(client.id)?.delete(room);
  }

  @SubscribeMessage('subscribe:market')
  handleSubscribeMarket(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { marketId: string },
  ) {
    const room = `market:${data.marketId}`;
    client.join(room);
    this.socketChannels.get(client.id)?.add(room);
    client.emit('subscribed', { channel: room });
  }

  @SubscribeMessage('subscribe:live')
  handleSubscribeLive(@ConnectedSocket() client: Socket) {
    client.join('live:all');
    client.emit('subscribed', { channel: 'live:all' });
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', { timestamp: Date.now() });
  }

  // ─── Server-side broadcasts ───────────────────────────────────────────────

  broadcastOddsUpdate(payload: {
    selectionId: string;
    marketId: string;
    eventId: string;
    oldOdds: number;
    newOdds: number;
  }) {
    this.server.to(`market:${payload.marketId}`).emit('odds:updated', payload);
    this.server.to(`event:${payload.eventId}`).emit('odds:updated', payload);
    this.logger.debug(`Odds broadcast: ${payload.selectionId} ${payload.oldOdds} -> ${payload.newOdds}`);
  }

  broadcastScoreUpdate(eventId: string, score: { home: number; away: number }) {
    this.server.to(`event:${eventId}`).emit('score:updated', { eventId, score });
    this.server.to('live:all').emit('score:updated', { eventId, score });
  }

  broadcastMarketSuspended(marketId: string, reason?: string) {
    this.server.to(`market:${marketId}`).emit('market:suspended', { marketId, reason });
  }

  broadcastMarketSettled(marketId: string, winnerSelectionId: string) {
    this.server.to(`market:${marketId}`).emit('market:settled', { marketId, winnerSelectionId });
  }

  broadcastBetResult(userId: string, payload: any) {
    this.server.to(`user:${userId}`).emit('bet:settled', payload);
  }

  broadcastWalletUpdate(userId: string, balance: any) {
    this.server.to(`user:${userId}`).emit('wallet:updated', balance);
  }

  broadcastToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  // ─── Redis → WS bridge ───────────────────────────────────────────────────

  private async _subscribeToRedisChannels() {
    const channels = [
      'odds:update',
      'event:score',
      'event:status',
      'market:suspended',
      'market:resumed',
      'market:settled',
      'bet:placed',
      'bet:settled',
      'bet:cashed_out',
    ];

    for (const channel of channels) {
      await this.redis.subscribe(channel, (message) => {
        this._handleRedisMessage(channel, message);
      });
    }

    this.logger.log(`Subscribed to ${channels.length} Redis channels`);
  }

  private _handleRedisMessage(channel: string, message: string) {
    try {
      const data = JSON.parse(message);

      switch (channel) {
        case 'odds:update':
          if (data.marketId) this.broadcastOddsUpdate(data);
          break;
        case 'event:score':
          this.broadcastScoreUpdate(data.eventId, data.score);
          break;
        case 'market:suspended':
          this.broadcastMarketSuspended(data.marketId, data.reason);
          break;
        case 'market:settled':
          this.broadcastMarketSettled(data.marketId, data.winnerSelectionId);
          break;
        case 'bet:settled':
          if (data.userId) this.broadcastBetResult(data.userId, data);
          break;
        case 'bet:cashed_out':
          if (data.userId) this.broadcastToUser(data.userId, 'cashout:completed', data);
          break;
        default:
          this.server.emit(channel.replace(':', '_'), data);
      }
    } catch (err) {
      this.logger.error(`Failed to handle Redis message on ${channel}`, err);
    }
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  getConnectedCount(): number {
    return this.server?.sockets?.sockets?.size || 0;
  }

  getUserCount(): number {
    return this.userSockets.size;
  }
}
