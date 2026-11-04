import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const CODE = /^[A-Za-z0-9._-]{1,30}$/;
const PHONE = /^[+\d\s.()-]{9,20}$/;

export class CreateClientDto {
  @Matches(CODE, { message: 'code: chữ, số, dấu chấm, gạch; tối đa 30 ký tự' })
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  @IsOptional() @IsIn(['managed', 'self_managed'])
  management_mode?: 'managed' | 'self_managed';

  @IsOptional() @IsString() @MaxLength(20)
  tax_code?: string;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string;

  @IsOptional() @IsString() @MaxLength(200)
  contact_name?: string;

  @IsOptional() @Matches(PHONE, { message: 'contact_phone: số điện thoại không hợp lệ' })
  contact_phone?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  contact_email?: string;

  @IsOptional() @IsUUID()
  account_manager_id?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class UpdateClientDto {
  @IsOptional() @Matches(CODE, { message: 'code: chữ, số, dấu chấm, gạch; tối đa 30 ký tự' })
  code?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @IsOptional() @IsIn(['managed', 'self_managed'])
  management_mode?: 'managed' | 'self_managed';

  @IsOptional() @IsString() @MaxLength(20)
  tax_code?: string | null;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  contact_name?: string | null;

  @IsOptional() @Matches(PHONE, { message: 'contact_phone: số điện thoại không hợp lệ' })
  contact_phone?: string | null;

  @IsOptional() @IsEmail() @MaxLength(200)
  contact_email?: string | null;

  @IsOptional() @IsUUID()
  account_manager_id?: string | null;

  @IsOptional() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
}
