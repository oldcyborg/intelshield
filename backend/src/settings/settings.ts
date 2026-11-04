/** System defaults. A company overrides any of them; a site overrides the company. */
export const SETTING_DEFAULTS = {
  late_after_minutes: 10,
  absent_after_minutes: 30,
  early_checkout_minutes: 10,
  round_tolerance_minutes: 15,
  patrol_photo_random_percent: 20,
  incident_escalate_medium_minutes: 30,
  incident_escalate_high_minutes: 10,
  incident_escalate_critical_minutes: 3,
  incident_close_by_leader_up_to: 'none' as 'none' | 'low' | 'medium',
};

export type Settings = typeof SETTING_DEFAULTS;
export type SettingKey = keyof Settings;
export type SettingSource = 'site' | 'company' | 'default';
export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

/** Keeps only known keys whose value has the default's type — anything else in the jsonb is ignored. */
export function cleanSettings(raw: Record<string, unknown> | null | undefined): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const value = raw?.[key];
    if (value !== undefined && value !== null && typeof value === typeof SETTING_DEFAULTS[key]) out[key] = value;
  }
  return out as Partial<Settings>;
}

export function resolveSettings(
  company: Record<string, unknown> | null | undefined,
  site: Record<string, unknown> | null | undefined,
): { effective: Settings; source: Record<SettingKey, SettingSource> } {
  const c = cleanSettings(company);
  const s = cleanSettings(site);
  const effective = { ...SETTING_DEFAULTS } as Record<string, unknown>;
  const source = {} as Record<SettingKey, SettingSource>;
  for (const key of SETTING_KEYS) {
    if (s[key] !== undefined) {
      effective[key] = s[key];
      source[key] = 'site';
    } else if (c[key] !== undefined) {
      effective[key] = c[key];
      source[key] = 'company';
    } else {
      source[key] = 'default';
    }
  }
  return { effective: effective as Settings, source };
}
