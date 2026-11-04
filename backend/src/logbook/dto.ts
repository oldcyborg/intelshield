import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { LOGBOOK_TYPES, LogbookType } from './logbook-entry.entity';

export class LogbookDto {
  @IsUUID()
  client_uuid: string;

  @IsISO8601({ strict: true })
  device_time: string;

  @IsOptional() @IsBoolean()
  captured_offline?: boolean;

  @IsIn(LOGBOOK_TYPES)
  type: LogbookType;

  @IsOptional() @IsString() @MaxLength(5000)
  body?: string;

  @IsOptional() @IsString() @MaxLength(200)
  visitor_name?: string;

  @IsOptional() @IsString() @MaxLength(200)
  visitor_org?: string;

  @IsOptional() @IsString() @MaxLength(200)
  meet_whom?: string;

  @IsOptional() @IsString() @MaxLength(500)
  purpose?: string;

  @IsOptional() @IsString() @MaxLength(30)
  plate?: string;

  @IsOptional() @IsString() @MaxLength(100)
  vehicle_kind?: string;

  @IsOptional() @IsString() @MaxLength(500)
  cargo?: string;

  @IsOptional() @IsString() @MaxLength(200)
  item?: string;

  @IsOptional() @IsInt() @Min(1)
  quantity?: number;

  @IsOptional() @IsIn(['received', 'handed_out', 'lent', 'returned'])
  asset_action?: 'received' | 'handed_out' | 'lent' | 'returned';

  @IsOptional() @IsString() @MaxLength(200)
  counterpart?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true })
  file_ids?: string[];
}

export class ExitDto {
  @IsISO8601({ strict: true })
  device_time: string;

  @IsOptional() @IsBoolean()
  captured_offline?: boolean;
}

export class LogbookFilter {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date: định dạng YYYY-MM-DD' })
  date: string;

  @IsOptional() @IsIn(LOGBOOK_TYPES)
  type?: LogbookType;

  @IsOptional() @IsString() @MaxLength(100)
  q?: string;
}

export class HandoverItemDto {
  @IsString() @MaxLength(200)
  label: string;

  @IsIn(['ok', 'missing', 'issue'])
  status: 'ok' | 'missing' | 'issue';

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class HandoverDto {
  @IsUUID()
  from_assignment_id: string;

  @IsOptional() @IsUUID()
  to_assignment_id?: string;

  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => HandoverItemDto)
  items: HandoverItemDto[];

  @IsOptional() @IsString() @MaxLength(5000)
  notes?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true })
  file_ids?: string[];
}

export class ReceiverDto {
  @IsUUID()
  to_assignment_id: string;
}

export class AnswerDto {
  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class HandoverItemsDto {
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(200, { each: true })
  items: string[];
}

export class HandoverFilter {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date: định dạng YYYY-MM-DD' })
  date: string;
}
