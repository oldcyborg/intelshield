import { resolveSettings, SETTING_DEFAULTS } from './settings';

describe('resolveSettings', () => {
  it('takes the site value, then the company value, then the system default', () => {
    const { effective, source } = resolveSettings({ late_after_minutes: 15, absent_after_minutes: 45 }, { late_after_minutes: 5 });
    expect(effective.late_after_minutes).toBe(5);
    expect(source.late_after_minutes).toBe('site');
    expect(effective.absent_after_minutes).toBe(45);
    expect(source.absent_after_minutes).toBe('company');
    expect(effective.incident_escalate_high_minutes).toBe(SETTING_DEFAULTS.incident_escalate_high_minutes);
    expect(source.incident_escalate_high_minutes).toBe('default');
  });

  it('ignores unknown keys and values of the wrong type', () => {
    const { effective } = resolveSettings({ late_after_minutes: 'abc' as unknown as number, foo: 1 } as never, {});
    expect(effective.late_after_minutes).toBe(SETTING_DEFAULTS.late_after_minutes);
    expect(effective).not.toHaveProperty('foo');
  });
});
