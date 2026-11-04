import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateGroupDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsOptional() @IsUUID()
  manager_user_id?: string;
}

export class UpdateGroupDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;

  /** null removes the manager. */
  @IsOptional() @IsUUID()
  manager_user_id?: string | null;
}

export class CreateTeamDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsOptional() @IsUUID()
  team_group_id?: string;
}

export class UpdateTeamDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;

  @IsOptional() @IsUUID()
  team_group_id?: string | null;

  @IsOptional() @IsUUID()
  leader_employee_id?: string | null;
}

export class AddMemberDto {
  @IsUUID()
  employee_id: string;

  /** First day in the new team. Defaults to today. */
  @IsOptional() @Matches(ISO_DATE, { message: 'start_date: định dạng YYYY-MM-DD' })
  start_date?: string;
}

export class LeaveTeamDto {
  /** First day no longer in the team. Defaults to today. */
  @IsOptional() @Matches(ISO_DATE, { message: 'left_on: định dạng YYYY-MM-DD' })
  left_on?: string;
}

export class SetLeaderDto {
  /** null clears the leader. */
  @IsOptional() @IsUUID()
  employee_id?: string | null;
}
