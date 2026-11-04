import {
  ArrayMaxSize, IsBoolean, IsISO8601, IsArray, IsIn, IsInt, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min,
} from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';
import { SEVERITIES, Severity } from './categories';

export class CategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsIn(SEVERITIES)
  default_severity: Severity;

  @IsOptional() @IsInt() @Min(0)
  sort?: number;
}

export class UpdateCategoryDto {
  @IsOptionalNonNull() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;

  @IsOptionalNonNull() @IsIn(SEVERITIES)
  default_severity?: Severity;

  @IsOptionalNonNull() @IsInt() @Min(0)
  sort?: number;

  @IsOptionalNonNull() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

/** Sent from the phone's queue: when it was done, and whether it is going out late. */
class Timing {
  @IsOptional() @IsISO8601({ strict: true })
  device_time?: string;

  @IsOptional() @IsBoolean()
  captured_offline?: boolean;
}

export class ReportIncidentDto extends Timing {
  @IsOptional() @IsUUID()
  client_uuid?: string;

  /** Where it happened. A guard may leave it out: their current shift's site is used. */
  @IsOptional() @IsUUID()
  site_id?: string;

  /** For reports about a client with no site on the system (self-managed clients). */
  @IsOptional() @IsUUID()
  client_id?: string;

  @IsUUID()
  category_id: string;

  /** Defaults to the category's severity. */
  @IsOptional() @IsIn(SEVERITIES)
  severity?: Severity;

  @IsOptional() @IsString() @MaxLength(200)
  title?: string;

  @IsString() @IsNotEmpty() @MaxLength(5000)
  description: string;

  @IsOptional() @IsLatitude()
  lat?: number;

  @IsOptional() @IsLongitude()
  lng?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true })
  file_ids?: string[];

  /** Office staff recording what a client told them. */
  @IsOptional() @IsIn(['staff', 'client_report'])
  source?: 'staff' | 'client_report';

  @IsOptional() @IsString() @MaxLength(200)
  client_reporter_name?: string;

  @IsOptional() @IsIn(['phone', 'zalo', 'email', 'in_person'])
  client_channel?: 'phone' | 'zalo' | 'email' | 'in_person';
}

export class SosDto extends Timing {
  @IsOptional() @IsUUID()
  client_uuid?: string;

  /** Sent when the phone has a fix; an SOS without one still goes out. */
  @IsOptional() @IsLatitude()
  lat?: number;

  @IsOptional() @IsLongitude()
  lng?: number;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class IncidentFilter {
  @IsOptional() @IsIn(['new', 'acknowledged', 'in_progress', 'resolved', 'closed', 'rejected', 'open'])
  status?: string;

  @IsOptional() @IsIn(SEVERITIES)
  severity?: Severity;

  @IsOptional() @IsUUID()
  site_id?: string;

  @IsOptional() @IsUUID()
  client_id?: string;
}

export class AssignDto {
  @IsUUID()
  user_id: string;
}

export class NoteDto {
  @IsOptional() @IsString() @MaxLength(5000)
  note?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true })
  file_ids?: string[];
}

export class ReasonDto {
  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

export class CommentDto {
  @IsString() @IsNotEmpty() @MaxLength(5000)
  body: string;

  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true })
  file_ids?: string[];
}

export class PushTokenDto {
  @IsString() @IsNotEmpty() @MaxLength(4096)
  token: string;
}

export class ContactCallDto {
  @IsUUID()
  contact_id: string;

  @IsIn(['phone', 'zalo', 'email'])
  channel: 'phone' | 'zalo' | 'email';
}
