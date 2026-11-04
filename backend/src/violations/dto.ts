import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { VIOLATION_STATUSES, VIOLATION_TYPES, ViolationStatus, ViolationType } from './violation.entity';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ViolationFilter {
  @IsOptional() @IsIn([...VIOLATION_STATUSES, 'open'])
  status?: ViolationStatus | 'open';

  @IsOptional() @IsIn(VIOLATION_TYPES)
  type?: ViolationType;

  @IsOptional() @IsUUID()
  site_id?: string;

  @IsOptional() @IsUUID()
  employee_id?: string;

  @IsOptional() @Matches(DAY, { message: 'from: định dạng YYYY-MM-DD' })
  from?: string;

  @IsOptional() @Matches(DAY, { message: 'to: định dạng YYYY-MM-DD' })
  to?: string;
}

export class DecisionDto {
  @IsIn(['confirm', 'waive'])
  decision: 'confirm' | 'waive';

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}
