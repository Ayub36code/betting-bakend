// src/market/dto/create-event.input.ts
import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsDateString, IsOptional } from 'class-validator';

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
  homeTeam?: string;

  @Field({ nullable: true })
  @IsOptional()
  awayTeam?: string;

  @Field()
  @IsDateString()
  startTime: Date;
}

// src/market/dto/create-market.input.ts
;
import { IsArray, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class SelectionInput {
  @Field()
  @IsString()
  name: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  code?: string;

  @Field()
  @IsNumber()
  odds: number;
}

@InputType()
export class CreateMarketInput {
  @Field()
  @IsString()
  eventId: string;

  @Field()
  @IsString()
  name: string;

  @Field()
  @IsString()
  type: string;

  @Field(() => [SelectionInput])
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectionInput)
  selections: SelectionInput[];

  @Field({ nullable: true })
  @IsOptional()
  @IsNumber()
  maxBetAmount?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsNumber()
  minBetAmount?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsNumber()
  maxExposure?: number;

  @Field({ nullable: true })
  @IsOptional()
  cutoffTime?: Date;
}
