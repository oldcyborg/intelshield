import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateDeploymentDto {
  @IsUUID()
  employee_id: string;

  @IsUUID()
  client_id: string;

  @IsOptional() @IsUUID()
  contract_id?: string;

  @IsOptional() @Matches(/^[a-z][a-z0-9_]{1,49}$/, { message: 'position: chữ thường, số, gạch dưới' })
  position?: string;

  /** First day at the client. Defaults to today; may be in the future. */
  @IsOptional() @Matches(ISO_DATE, { message: 'start_date: định dạng YYYY-MM-DD' })
  start_date?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class EndDeploymentDto {
  /** Last day at the client. */
  @Matches(ISO_DATE, { message: 'last_day: định dạng YYYY-MM-DD' })
  last_day: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  reason?: string;
}

export class DeploymentFilter {
  @IsOptional() @IsUUID()
  client_id?: string;

  @IsOptional() @IsUUID()
  employee_id?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'on: định dạng YYYY-MM-DD' })
  on?: string;
}
