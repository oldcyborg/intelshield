import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const POSITION = /^[a-z][a-z0-9_]{1,49}$/;
export const PRICE_UNITS = ['per_guard_month', 'per_shift', 'per_hour'] as const;

export class LineInputDto {
  @Matches(POSITION, { message: 'position: chữ thường, số, gạch dưới' })
  position: string;

  @IsInt() @Min(1) @Max(1000)
  headcount: number;

  @IsIn(PRICE_UNITS)
  unit: (typeof PRICE_UNITS)[number];

  /** Whole đồng. Sent as a JSON integer; stored as numeric(14,0). */
  @IsInt() @Min(0) @Max(10_000_000_000)
  unit_price: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0.5) @Max(24)
  shift_hours?: number;
}

export class CreateContractDto {
  @IsUUID()
  client_id: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  contract_no: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'signed_at: định dạng YYYY-MM-DD' })
  signed_at?: string;

  @Matches(ISO_DATE, { message: 'start_date: định dạng YYYY-MM-DD' })
  start_date: string;

  @Matches(ISO_DATE, { message: 'end_date: định dạng YYYY-MM-DD' })
  end_date: string;

  @IsOptional() @IsInt() @Min(0) @Max(365)
  notice_days?: number;

  @IsOptional() @IsBoolean()
  auto_renew?: boolean;

  @IsOptional() @IsUUID()
  file_id?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => LineInputDto)
  lines: LineInputDto[];
}

export class UpdateContractDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50)
  contract_no?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'signed_at: định dạng YYYY-MM-DD' })
  signed_at?: string | null;

  @IsOptional() @Matches(ISO_DATE, { message: 'start_date: định dạng YYYY-MM-DD' })
  start_date?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'end_date: định dạng YYYY-MM-DD' })
  end_date?: string;

  @IsOptional() @IsInt() @Min(0) @Max(365)
  notice_days?: number;

  @IsOptional() @IsBoolean()
  auto_renew?: boolean;

  /** Draft → signed. Termination has its own route. */
  @IsOptional() @IsIn(['signed'])
  state?: 'signed';

  @IsOptional() @IsUUID()
  file_id?: string | null;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
}

export class TerminateContractDto {
  @IsOptional() @Matches(ISO_DATE, { message: 'terminated_on: định dạng YYYY-MM-DD' })
  terminated_on?: string;
}

export class ChangePriceDto extends LineInputDto {
  @Matches(ISO_DATE, { message: 'effective_from: định dạng YYYY-MM-DD' })
  effective_from: string;
}

export class EndPositionDto {
  @Matches(ISO_DATE, { message: 'last_day: định dạng YYYY-MM-DD' })
  last_day: string;
}
