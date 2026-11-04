import { IsBoolean, IsInt, IsISO8601, IsLatitude, IsLongitude, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CheckDto {
  @IsUUID()
  assignment_id: string;

  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;

  @IsOptional() @IsInt() @Min(0) @Max(100_000)
  accuracy_m?: number;

  @IsUUID()
  selfie_file_id: string;

  /** The phone's own clock, kept to spot a phone whose time was changed. */
  @IsISO8601()
  device_time: string;

  /** The app's own mock-location detection (Android reports it; iOS only partly). */
  @IsOptional() @IsBoolean()
  mock_location?: boolean;
}

export class MyShiftsFilter {
  @Matches(ISO_DATE, { message: 'from: định dạng YYYY-MM-DD' })
  from: string;

  @Matches(ISO_DATE, { message: 'to: định dạng YYYY-MM-DD' })
  to: string;
}

export class BoardFilter {
  @IsUUID()
  site_id: string;

  @Matches(ISO_DATE, { message: 'date: định dạng YYYY-MM-DD' })
  date: string;
}
