// src/user/types/user.types.ts
import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import { Role } from '@prisma/client';

registerEnumType(Role, { name: 'Role' });

@ObjectType()
export class UserType {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;

  @Field()
  username: string;

  @Field(() => Role)
  role: Role;

  @Field()
  isActive: boolean;

  @Field()
  isVerified: boolean;

  @Field()
  kycVerified: boolean;

  @Field({ nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  lastName?: string;

  @Field({ nullable: true })
  phoneNumber?: string;

  @Field({ nullable: true })
  country?: string;

  @Field({ nullable: true })
  lastLoginAt?: Date;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@ObjectType()
export class UserListResponse {
  @Field(() => [UserType])
  data: UserType[];

  @Field()
  total: number;

  @Field()
  page: number;

  @Field()
  totalPages: number;
}
