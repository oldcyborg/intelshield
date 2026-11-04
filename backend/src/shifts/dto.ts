import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const POSITION = /^[a-z][a-z0-9_]{1,49}$/;
/** An instant must say which zone it is in: a bare "22:00" would be read in the server's zone. */
const ZONED = /(Z|[+-]\d{2}:?\d{2})$/;

export class TemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @Matches(HHMM, { message: 'start_time: định dạng HH:MM' })
  start_time: string;

  @Matches(HHMM, { message: 'end_time: định dạng HH:MM' })
  end_time: string;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  headcount?: number;

  @IsOptional() @Matches(POSITION, { message: 'position: chữ thường, số, gạch dưới' })
  position?: string;
}

export class UpdateTemplateDto {
  @IsOptionalNonNull() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;

  @IsOptionalNonNull() @Matches(HHMM, { message: 'start_time: định dạng HH:MM' })
  start_time?: string;

  @IsOptionalNonNull() @Matches(HHMM, { message: 'end_time: định dạng HH:MM' })
  end_time?: string;

  @IsOptionalNonNull() @IsInt() @Min(1) @Max(100)
  headcount?: number;

  @IsOptionalNonNull() @Matches(POSITION, { message: 'position: chữ thường, số, gạch dưới' })
  position?: string;

  @IsOptionalNonNull() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

export class CreateAssignmentDto {
  @IsUUID()
  site_id: string;

  @IsUUID()
  employee_id: string;

  /** Either a template and a date… */
  @IsOptional() @IsUUID()
  template_id?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'shift_date: định dạng YYYY-MM-DD' })
  shift_date?: string;

  /** …or explicit instants for a one-off shift. */
  @IsOptional() @IsISO8601({ strict: true }) @Matches(ZONED, { message: 'start_at: cần kèm múi giờ, VD 2026-10-13T22:00+07:00' })
  start_at?: string;

  @IsOptional() @IsISO8601({ strict: true }) @Matches(ZONED, { message: 'end_at: cần kèm múi giờ, VD 2026-10-14T06:00+07:00' })
  end_at?: string;

  @IsOptional() @IsUUID()
  post_id?: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class CopyWeekDto {
  @IsUUID()
  site_id: string;

  @Matches(ISO_DATE, { message: 'from_week: định dạng YYYY-MM-DD' })
  from_week: string;

  @Matches(ISO_DATE, { message: 'to_week: định dạng YYYY-MM-DD' })
  to_week: string;
}

export class SubstituteDto {
  @IsUUID()
  employee_id: string;
}

export class RosterFilter {
  @IsUUID()
  site_id: string;

  @Matches(ISO_DATE, { message: 'from: định dạng YYYY-MM-DD' })
  from: string;

  @Matches(ISO_DATE, { message: 'to: định dạng YYYY-MM-DD' })
  to: string;
}
