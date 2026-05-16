// src/auth/dto/login.input.ts
import { InputType, Field } from '@nestjs/graphql';
import { IsString, MinLength } from 'class-validator';

@InputType()
export class LoginInput {
  @Field()
  @IsString()
  identifier: string;

  @Field()
  @IsString()
  @MinLength(6)
  password: string;
}
