import {
  ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsLatitude, IsLongitude, IsNotEmpty,
  IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ScheduleDto {
  @IsUUID()
  route_id: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @Matches(HHMM, { message: 'start_time: định dạng HH:MM' })
  start_time: string;

  /** Smaller than start_time: the window crosses midnight. Equal: the whole day. */
  @Matches(HHMM, { message: 'end_time: định dạng HH:MM' })
  end_time: string;

  @IsInt() @Min(15) @Max(720)
  interval_minutes: number;

  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true })
  days?: number[];
}

export class UpdateScheduleDto {
  @IsOptionalNonNull() @IsUUID()
  route_id?: string;

  @IsOptionalNonNull() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;

  @IsOptionalNonNull() @Matches(HHMM, { message: 'start_time: định dạng HH:MM' })
  start_time?: string;

  @IsOptionalNonNull() @Matches(HHMM, { message: 'end_time: định dạng HH:MM' })
  end_time?: string;

  @IsOptionalNonNull() @IsInt() @Min(15) @Max(720)
  interval_minutes?: number;

  @IsOptionalNonNull() @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true })
  days?: number[];

  @IsOptionalNonNull() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

/** One step of a round sent from the phone; `client_uuid` makes a resend harmless. */
class OfflineAware {
  @IsUUID()
  client_uuid: string;

  @IsISO8601({ strict: true })
  device_time: string;

  @IsOptional() @IsBoolean()
  captured_offline?: boolean;
}

export class StartRoundDto {
  @IsISO8601({ strict: true })
  device_time: string;

  @IsOptional() @IsBoolean()
  captured_offline?: boolean;
}

export class ScanDto extends OfflineAware {
  @IsIn(['qr', 'gps', 'photo', 'nfc'])
  method: 'qr' | 'gps' | 'photo' | 'nfc';

  /** Required for GPS and photo; for QR it comes from the tag and must match when given. */
  @IsOptional() @IsUUID()
  checkpoint_id?: string;

  @IsOptional() @IsString() @MaxLength(200)
  qr_payload?: string;

  @IsOptional() @IsLatitude()
  lat?: number;

  @IsOptional() @IsLongitude()
  lng?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100000)
  accuracy_m?: number;

  @IsOptional() @IsBoolean()
  mock_location?: boolean;

  @IsOptional() @IsUUID()
  photo_file_id?: string;

  /** Offline only: when the phone last reached the server, and the monotonic time elapsed since, to catch a reset clock. */
  @IsOptional() @IsISO8601({ strict: true })
  last_sync_at?: string;

  @IsOptional() @IsInt() @Min(0)
  elapsed_since_sync_ms?: number;
}

export class RoundsFilter {
  @IsUUID()
  site_id: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date: định dạng YYYY-MM-DD' })
  date: string;
}

export class MyRoundsFilter {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date: định dạng YYYY-MM-DD' })
  date?: string;
}
