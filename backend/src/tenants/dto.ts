import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class TenantAdminDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  full_name: string;

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string;

  @IsString() @MinLength(8) @MaxLength(100)
  password: string;
}

export class CreateTenantDto {
  @Matches(/^[a-z0-9][a-z0-9-]{1,39}$/, { message: 'code: chữ thường, số, gạch nối; 2–40 ký tự' })
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  @ValidateNested() @Type(() => TenantAdminDto)
  admin: TenantAdminDto;
}

export class UpdateTenantDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @IsOptional() @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';
}
