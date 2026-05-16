// src/risk/risk.module.ts
import { Module } from '@nestjs/common';
import { RiskService } from './risk.service';
import { RiskResolver } from './risk.resolver';

@Module({
  providers: [RiskService, RiskResolver],
  exports: [RiskService],
})
export class RiskModule {}

// src/risk/risk.resolver.ts
