// src/auth/types/auth.types.ts
import { ObjectType, Field } from '@nestjs/graphql';
import { UserType } from '../../user/types/user.types';

@ObjectType()
export class AuthResponse {
  @Field(() => UserType)
  user: UserType;

  @Field()
  accessToken: string;

  @Field()
  refreshToken: string;
}

@ObjectType()
export class TokenResponse {
  @Field()
  accessToken: string;

  @Field()
  refreshToken: string;
}

@ObjectType()
export class LogoutResponse {
  @Field()
  success: boolean;

  @Field()
  message: string;
}
