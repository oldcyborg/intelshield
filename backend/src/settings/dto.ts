import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Every field optional; `null` removes the value at this level so the level above applies. */
export class SettingsPatchDto {
  @IsOptional() @IsInt() @Min(1) @Max(240)
  late_after_minutes?: number | null;

  @IsOptional() @IsInt() @Min(2) @Max(480)
  absent_after_minutes?: number | null;

  @IsOptional() @IsInt() @Min(0) @Max(240)
  early_checkout_minutes?: number | null;

  @IsOptional() @IsInt() @Min(0) @Max(120)
  round_tolerance_minutes?: number | null;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  patrol_photo_random_percent?: number | null;

  @IsOptional() @IsInt() @Min(1) @Max(240)
  incident_escalate_medium_minutes?: number | null;

  @IsOptional() @IsInt() @Min(1) @Max(120)
  incident_escalate_high_minutes?: number | null;

  @IsOptional() @IsInt() @Min(1) @Max(30)
  incident_escalate_critical_minutes?: number | null;

  @IsOptional() @IsIn(['none', 'low', 'medium'])
  incident_close_by_leader_up_to?: 'none' | 'low' | 'medium' | null;
}
