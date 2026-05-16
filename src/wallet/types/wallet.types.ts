// src/wallet/types/wallet.types.ts
import { ObjectType, Field, ID, Float, registerEnumType } from '@nestjs/graphql';
import { TransactionType, TransactionStatus } from '@prisma/client';

registerEnumType(TransactionType, { name: 'TransactionType' });
registerEnumType(TransactionStatus, { name: 'TransactionStatus' });

@ObjectType()
export class WalletType {
  @Field(() => ID)
  id: string;

  @Field()
  userId: string;

  @Field(() => Float)
  balance: number;

  @Field(() => Float)
  bonusBalance: number;

  @Field(() => Float)
  reservedBalance: number;

  @Field()
  currency: string;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class BalanceResponse {
  @Field(() => Float)
  balance: number;

  @Field(() => Float)
  bonusBalance: number;

  @Field(() => Float)
  reservedBalance: number;

  @Field(() => Float)
  availableBalance: number;

  @Field()
  currency: string;
}

@ObjectType()
export class TransactionType2 {
  @Field(() => ID)
  id: string;

  @Field()
  userId: string;

  @Field(() => TransactionType)
  type: TransactionType;

  @Field(() => TransactionStatus)
  status: TransactionStatus;

  @Field(() => Float)
  amount: number;

  @Field(() => Float)
  balanceBefore: number;

  @Field(() => Float)
  balanceAfter: number;

  @Field({ nullable: true })
  referenceId?: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class LedgerResponse {
  @Field(() => [TransactionType2])
  data: TransactionType2[];

  @Field()
  total: number;

  @Field()
  page: number;

  @Field()
  totalPages: number;
}
