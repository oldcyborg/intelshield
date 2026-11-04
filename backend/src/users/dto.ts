import { Type } from 'class-transformer';
import {
  IsArray, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested,
} from 'class-validator';

const PHONE = /^[+\d\s.()-]{9,20}$/;

export class ScopeInputDto {
  @IsIn(['tenant', 'team_group', 'team', 'client', 'site'])
  scope_type: 'tenant' | 'team_group' | 'team' | 'client' | 'site';

  @IsOptional() @IsUUID()
  scope_id?: string;
}

export class CreateUserDto {
  @IsIn(['staff', 'guard'])
  user_type: 'staff' | 'guard';

  @IsString() @IsNotEmpty() @MaxLength(200)
  full_name: string;

  @IsOptional() @Matches(PHONE, { message: 'phone: số điện thoại không hợp lệ' })
  phone?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string;

  @IsString() @MinLength(8) @MaxLength(100)
  password: string;

  @IsOptional() @IsUUID()
  employee_id?: string;

  @IsArray() @IsUUID('all', { each: true })
  role_ids: string[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => ScopeInputDto)
  scopes: ScopeInputDto[];
}

export class UpdateUserDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  full_name?: string;

  @IsOptional() @Matches(PHONE, { message: 'phone: số điện thoại không hợp lệ' })
  phone?: string | null;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string | null;

  @IsOptional() @IsIn(['active', 'locked'])
  status?: 'active' | 'locked';

  @IsOptional() @IsArray() @IsUUID('all', { each: true })
  role_ids?: string[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ScopeInputDto)
  scopes?: ScopeInputDto[];
}

export class ResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(100)
  new_password: string;
}
