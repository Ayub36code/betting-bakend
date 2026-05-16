// src/websocket/websocket.module.ts
import { Module } from '@nestjs/common';
import { BettingGateway } from './websocket.gateway';
import { AuthModule } from '@auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [BettingGateway],
  exports: [BettingGateway],
})
export class WebsocketModule {}
