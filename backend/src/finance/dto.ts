import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';
import { ADJUSTMENT_KINDS, AdjustmentKind } from './payroll-engine';

const MONEY_MAX = 1_000_000_000_000;

export class FinanceSettingsDto {
  @IsOptionalNonNull() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(31)
  standard_shifts?: number;

  @IsOptionalNonNull() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10)
  holiday_coefficient?: number;

  @IsOptionalNonNull() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10)
  overtime_coefficient?: number;

  @IsOptionalNonNull() @IsArray() @ArrayMaxSize(60) @IsDateString({ strict: true }, { each: true })
  holidays?: string[];

  /** Amount taken from pay for each confirmed violation, by type. */
  @IsOptionalNonNull() @IsObject()
  penalties?: Record<string, number>;

  @IsOptionalNonNull() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  vat_rate?: number;

  @IsOptionalNonNull() @IsInt() @Min(0) @Max(365)
  payment_terms_days?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  payment_info?: string | null;
}

export class MonthDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month: dạng YYYY-MM' })
  month: string;
}

export class AdjustmentDto {
  @IsIn(ADJUSTMENT_KINDS)
  kind: AdjustmentKind;

  /** Positive; only "other" may be negative (a deduction). */
  @IsInt() @Min(-MONEY_MAX) @Max(MONEY_MAX)
  amount: number;

  @IsOptional() @IsString() @MaxLength(200)
  note?: string;
}

export class AdjustmentsDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => AdjustmentDto)
  items: AdjustmentDto[];
}

export class ReasonDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason: string;
}

export class PaidDto {
  @IsDateString({ strict: true })
  paid_on: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class BillingFilter {
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month: dạng YYYY-MM' })
  month?: string;

  @IsOptional() @IsUUID()
  client_id?: string;
}

export class StatementPatchDto {
  @IsOptionalNonNull() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  vat_rate?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
}

/** Whether a suggested deduction for missing guards goes on the bill. */
export class ShortfallDto {
  @IsBoolean()
  applied: boolean;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
}

/** A line the accountant adds: positive charges, negative discounts. */
export class ExtraLineDto {
  @IsString() @IsNotEmpty() @MaxLength(300)
  description: string;

  @IsInt() @Min(-MONEY_MAX) @Max(MONEY_MAX)
  amount: number;
}

export class PaymentDto {
  @IsDateString({ strict: true })
  paid_on: string;

  @IsInt() @Min(1) @Max(MONEY_MAX)
  amount: number;

  @IsIn(['transfer', 'cash', 'other'])
  method: 'transfer' | 'cash' | 'other';

  @IsOptional() @IsString() @MaxLength(100)
  reference?: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}
