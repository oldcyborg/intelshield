import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, IsUUID,
  Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';
import { CHECK_METHODS, CheckMethod, PHOTO_RULES, PhotoRule } from './checkpoint.entity';

const CODE = /^[A-Za-z0-9._-]{1,30}$/;
const CODE_MESSAGE = { message: 'code: chữ, số, dấu chấm, gạch; tối đa 30 ký tự' };

export class CreateSiteDto {
  @IsUUID()
  client_id: string;

  @Matches(CODE, CODE_MESSAGE)
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string;

  @IsOptional() @IsLatitude()
  lat?: number;

  @IsOptional() @IsLongitude()
  lng?: number;

  @IsOptional() @IsInt() @Min(20) @Max(2000)
  geofence_radius_m?: number;

  @IsOptional() @IsUUID()
  responsible_team_id?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class UpdateSiteDto {
  @IsOptionalNonNull() @Matches(CODE, CODE_MESSAGE)
  code?: string;

  @IsOptionalNonNull() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string | null;

  @IsOptional() @IsLatitude()
  lat?: number | null;

  @IsOptional() @IsLongitude()
  lng?: number | null;

  @IsOptionalNonNull() @IsInt() @Min(20) @Max(2000)
  geofence_radius_m?: number;

  @IsOptional() @IsUUID()
  responsible_team_id?: string | null;

  @IsOptionalNonNull() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
}

export class PostDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class CreateCheckpointDto {
  @Matches(CODE, CODE_MESSAGE)
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  @IsOptional() @IsLatitude()
  lat?: number;

  @IsOptional() @IsLongitude()
  lng?: number;

  @IsOptional() @IsInt() @Min(5) @Max(500)
  radius_m?: number;

  @IsOptional() @IsArray() @ArrayMinSize(1) @IsIn(CHECK_METHODS, { each: true })
  allowed_methods?: CheckMethod[];

  @IsOptional() @IsIn(PHOTO_RULES)
  photo_rule?: PhotoRule;

  @IsOptional() @IsString() @MaxLength(2000)
  instructions?: string;
}

export class UpdateCheckpointDto {
  @IsOptionalNonNull() @Matches(CODE, CODE_MESSAGE)
  code?: string;

  @IsOptionalNonNull() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @IsOptional() @IsLatitude()
  lat?: number | null;

  @IsOptional() @IsLongitude()
  lng?: number | null;

  @IsOptionalNonNull() @IsInt() @Min(5) @Max(500)
  radius_m?: number;

  @IsOptionalNonNull() @IsArray() @ArrayMinSize(1) @IsIn(CHECK_METHODS, { each: true })
  allowed_methods?: CheckMethod[];

  @IsOptionalNonNull() @IsIn(PHOTO_RULES)
  photo_rule?: PhotoRule;

  @IsOptional() @IsString() @MaxLength(2000)
  instructions?: string | null;

  @IsOptionalNonNull() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

export class RouteStopDto {
  @IsUUID()
  checkpoint_id: string;

  @IsOptional() @IsBoolean()
  required?: boolean;
}

export class RouteDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => RouteStopDto)
  checkpoints: RouteStopDto[];
}

export class ResolveQrDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  payload: string;
}

const CONTACT_PHONE = /^[+\d\s.()-]{8,20}$/;
export const CONTACT_LEVELS = ['staff', 'leader', 'guard'] as const;
export type ContactLevel = (typeof CONTACT_LEVELS)[number];

/** A person at the client to reach about a site: at least one of phone, Zalo or email. */
export class CreateContactDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  full_name: string;

  @IsOptional() @IsString() @MaxLength(100)
  title?: string | null;

  @IsOptional() @Matches(CONTACT_PHONE, { message: 'phone: số điện thoại không hợp lệ' })
  phone?: string | null;

  @IsOptional() @Matches(CONTACT_PHONE, { message: 'zalo: số Zalo không hợp lệ' })
  zalo?: string | null;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string | null;

  @IsOptional() @IsString() @MaxLength(100)
  hours?: string | null;

  @IsOptionalNonNull() @IsInt() @Min(1) @Max(99)
  priority?: number;

  @IsOptionalNonNull() @IsIn(CONTACT_LEVELS)
  visibility?: ContactLevel;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
}

export class UpdateContactDto {
  @IsOptionalNonNull() @IsString() @IsNotEmpty() @MaxLength(200)
  full_name?: string;

  @IsOptional() @IsString() @MaxLength(100)
  title?: string | null;

  @IsOptional() @Matches(CONTACT_PHONE, { message: 'phone: số điện thoại không hợp lệ' })
  phone?: string | null;

  @IsOptional() @Matches(CONTACT_PHONE, { message: 'zalo: số Zalo không hợp lệ' })
  zalo?: string | null;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string | null;

  @IsOptional() @IsString() @MaxLength(100)
  hours?: string | null;

  @IsOptionalNonNull() @IsInt() @Min(1) @Max(99)
  priority?: number;

  @IsOptionalNonNull() @IsIn(CONTACT_LEVELS)
  visibility?: ContactLevel;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
}
