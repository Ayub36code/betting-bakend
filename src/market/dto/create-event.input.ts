// src/market/dto/create-event.input.ts
import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsOptional, IsDateString } from 'class-validator';

@InputType()
export class CreateEventInput {
  @Field()
  @IsString()
  sportId: string;

  @Field()
  @IsString()
  name: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  slug?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  homeTeam?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  awayTeam?: string;

  @Field()
  startTime: Date;
}
