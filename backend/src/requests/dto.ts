import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { CORRECTION_REASONS, CorrectionReason, OPEN_CORRECTION } from './attendance-correction.entity';
import { MONTHLY_MODES, MonthlyMode, PAY_TYPES, PayType } from './employee-pay.entity';
import { LEAVE_TYPES, LeaveType } from './leave-request.entity';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** An instant must say which zone it is in. */
const ZONED = /(Z|[+-]\d{2}:?\d{2})$/;
const MONEY_MAX = 1_000_000_000_000;

export class PayDto {
  @IsIn(PAY_TYPES)
  pay_type: PayType;

  /** For a monthly salary: counted by attendance (default) or fixed. */
  @IsOptional() @IsIn(MONTHLY_MODES)
  monthly_mode?: MonthlyMode;

  @IsOptional() @IsInt() @Min(0) @Max(MONEY_MAX)
  base_pay?: number | null;

  @IsOptional() @IsInt() @Min(0) @Max(MONEY_MAX)
  allowance?: number | null;

  @IsOptional() @IsString() @MaxLength(100)
  bank_name?: string | null;

  @IsOptional() @Matches(/^[0-9 .-]{4,40}$/, { message: 'bank_account: chỉ chữ số, tối đa 40 ký tự' })
  bank_account?: string | null;

  @IsOptional() @Matches(/^[0-9-]{8,20}$/, { message: 'tax_code: mã số thuế không hợp lệ' })
  tax_code?: string | null;

  @IsOptional() @Matches(/^[0-9A-Za-z]{6,20}$/, { message: 'social_insurance_no: số BHXH không hợp lệ' })
  social_insurance_no?: string | null;

  /** Fixed social insurance taken from each month's pay. */
  @IsOptional() @IsInt() @Min(0) @Max(MONEY_MAX)
  social_insurance?: number | null;

  /** Empty = annual leave is not counted for this person. */
  @IsOptional() @IsInt() @Min(0) @Max(365)
  annual_leave_days?: number | null;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
}

export class YearQuery {
  @IsOptional() @Matches(/^\d{4}$/, { message: 'year: năm 4 chữ số' })
  year?: string;
}

export class LeaveDto {
  @IsUUID()
  client_uuid: string;

  @IsIn(LEAVE_TYPES)
  type: LeaveType;

  @Matches(ISO_DATE, { message: 'from_date: định dạng YYYY-MM-DD' }) @IsISO8601({ strict: true }, { message: 'from_date: ngày không có thật' })
  from_date: string;

  @Matches(ISO_DATE, { message: 'to_date: định dạng YYYY-MM-DD' }) @IsISO8601({ strict: true }, { message: 'to_date: ngày không có thật' })
  to_date: string;

  @IsOptional() @IsString() @MaxLength(1000)
  reason?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsUUID('all', { each: true })
  file_ids?: string[];

  /** Someone else's request, written by their leader or manager (they phoned in). */
  @IsOptional() @IsUUID()
  employee_id?: string;
}

export class NoteDto {
  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class LeaveFilter {
  @IsOptional() @IsIn(['pending', 'approved', 'rejected', 'cancelled'])
  status?: 'pending' | 'approved' | 'rejected' | 'cancelled';

  @IsOptional() @IsUUID()
  employee_id?: string;

  /** Requests touching any day from…to. */
  @IsOptional() @Matches(ISO_DATE, { message: 'from: định dạng YYYY-MM-DD' }) @IsISO8601({ strict: true }, { message: 'from: ngày không có thật' })
  from?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'to: định dạng YYYY-MM-DD' }) @IsISO8601({ strict: true }, { message: 'to: ngày không có thật' })
  to?: string;
}

export class CorrectionDto {
  @IsUUID()
  client_uuid: string;

  @IsUUID()
  assignment_id: string;

  @IsOptional() @IsISO8601({ strict: true }) @Matches(ZONED, { message: 'check_in_at: cần kèm múi giờ' })
  check_in_at?: string;

  @IsOptional() @IsISO8601({ strict: true }) @Matches(ZONED, { message: 'check_out_at: cần kèm múi giờ' })
  check_out_at?: string;

  @IsIn(CORRECTION_REASONS)
  reason_code: CorrectionReason;

  @IsOptional() @IsString() @MaxLength(1000)
  reason?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsUUID('all', { each: true })
  file_ids?: string[];
}

export class CorrectionDecisionDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class CorrectionFilter {
  @IsOptional() @IsIn(['open', ...OPEN_CORRECTION, 'approved', 'rejected', 'cancelled'])
  status?: string;

  @IsOptional() @IsUUID()
  site_id?: string;

  @IsOptional() @IsUUID()
  employee_id?: string;
}
