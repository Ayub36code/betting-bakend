// src/bet/dto/place-bet.input.ts
import { InputType, Field, registerEnumType } from '@nestjs/graphql';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';

export enum BetTypeEnum {
  SINGLE = 'SINGLE',
  MULTI = 'MULTI',
  SYSTEM = 'SYSTEM',
}

export enum OddsChangePolicyEnum {
  REJECT = 'REJECT',
  ACCEPT_BETTER = 'ACCEPT_BETTER',
  ACCEPT_ANY = 'ACCEPT_ANY',
}

registerEnumType(BetTypeEnum, { name: 'BetTypeEnum' });
registerEnumType(OddsChangePolicyEnum, { name: 'OddsChangePolicyEnum' });

@InputType()
export class PlaceBetInput {
  @Field(() => [String])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  selectionIds: string[];

  @Field()
  @IsNumber()
  @Min(0.01)
  stake: number;

  @Field(() => BetTypeEnum, { defaultValue: BetTypeEnum.SINGLE })
  @IsEnum(BetTypeEnum)
  betType: string;

  @Field(() => OddsChangePolicyEnum, { nullable: true })
  @IsOptional()
  @IsEnum(OddsChangePolicyEnum)
  oddsChangePolicy?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsNumber()
  systemSize?: number; // for system bets, e.g. 2 for 2/3, 3 for 3/4

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  note?: string;
}
