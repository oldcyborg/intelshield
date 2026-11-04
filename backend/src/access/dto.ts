import { IsArray, IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ALL_PERMISSIONS } from './permissions';

export class SetPermissionsDto {
  @IsArray() @IsIn(ALL_PERMISSIONS, { each: true })
  permissions: string[];
}

export class CreateRoleDto extends SetPermissionsDto {
  @Matches(/^[a-z][a-z0-9_]{1,49}$/, { message: 'code: chữ thường, số, gạch dưới; bắt đầu bằng chữ' })
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;
}
