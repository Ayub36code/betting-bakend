// src/auth/strategies/local.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private auth: AuthService) {
    super({ usernameField: 'identifier' });
  }

  async validate(identifier: string, password: string) {
    const result = await this.auth.login({ identifier, password });
    if (!result) throw new UnauthorizedException('Invalid credentials');
    return result.user;
  }
}
