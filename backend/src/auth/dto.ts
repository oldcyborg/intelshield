import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  identifier: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  password: string;

  @IsOptional() @IsString() @MaxLength(200)
  device_label?: string;

  /** The app's installation id; binds the session to that phone. */
  @IsOptional() @Matches(/^[\w.:-]{4,200}$/, { message: 'device_id: không hợp lệ' })
  device_id?: string;

  @IsOptional() @IsIn(['android', 'ios', 'web'])
  platform?: string;
}

export class RefreshDto {
  @IsOptional() @IsString() @MaxLength(500)
  refresh_token?: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  current_password: string;

  @IsString() @MinLength(8) @MaxLength(100)
  new_password: string;
}
