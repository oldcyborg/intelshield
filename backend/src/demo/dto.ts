import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DemoKeyDto {
  @IsOptional() @IsString() @MaxLength(200)
  key?: string;
}
