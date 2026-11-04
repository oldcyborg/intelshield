import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { DOCUMENT_KINDS, DocumentKind } from './employee-document.entity';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const POSITIONS = ['guard', 'team_leader', 'supervisor', 'office'] as const;

export class CreateEmployeeDto {
  @Matches(/^[A-Za-z0-9._-]{1,30}$/, { message: 'code: chữ, số, dấu chấm, gạch; tối đa 30 ký tự' })
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  full_name: string;

  @IsOptional() @Matches(/^[+\d\s.()-]{9,20}$/, { message: 'phone: số điện thoại không hợp lệ' })
  phone?: string;

  @IsOptional() @IsIn(POSITIONS)
  position?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'date_of_birth: định dạng YYYY-MM-DD' })
  date_of_birth?: string;

  @IsOptional() @Matches(/^\d{9,12}$/, { message: 'national_id: 9 hoặc 12 chữ số' })
  national_id?: string;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'hire_date: định dạng YYYY-MM-DD' })
  hire_date?: string;

  @IsOptional() @IsString() @MaxLength(200)
  emergency_contact?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class UpdateEmployeeDto {
  @IsOptional() @Matches(/^[A-Za-z0-9._-]{1,30}$/, { message: 'code: chữ, số, dấu chấm, gạch; tối đa 30 ký tự' })
  code?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  full_name?: string;

  @IsOptional() @Matches(/^[+\d\s.()-]{9,20}$/, { message: 'phone: số điện thoại không hợp lệ' })
  phone?: string | null;

  @IsOptional() @IsIn(POSITIONS)
  position?: string;

  @IsOptional() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional() @Matches(ISO_DATE, { message: 'date_of_birth: định dạng YYYY-MM-DD' })
  date_of_birth?: string | null;

  @IsOptional() @Matches(/^\d{9,12}$/, { message: 'national_id: 9 hoặc 12 chữ số' })
  national_id?: string | null;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string | null;

  @IsOptional() @Matches(ISO_DATE, { message: 'hire_date: định dạng YYYY-MM-DD' })
  hire_date?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  emergency_contact?: string | null;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
}

export class CreateDocumentDto {
  @IsIn(DOCUMENT_KINDS)
  kind: DocumentKind;

  @IsOptional() @IsString() @MaxLength(50)
  number?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'issued_on: định dạng YYYY-MM-DD' })
  issued_on?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'expires_on: định dạng YYYY-MM-DD' })
  expires_on?: string;

  @IsOptional() @IsUUID()
  file_id?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class UpdateDocumentDto {
  @IsOptional() @IsString() @MaxLength(50)
  number?: string | null;

  @IsOptional() @Matches(ISO_DATE, { message: 'issued_on: định dạng YYYY-MM-DD' })
  issued_on?: string | null;

  @IsOptional() @Matches(ISO_DATE, { message: 'expires_on: định dạng YYYY-MM-DD' })
  expires_on?: string | null;

  @IsOptional() @IsUUID()
  file_id?: string | null;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
}
