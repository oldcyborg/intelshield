import { normalizePhone, parseIdentifier, PHONE_PATTERN } from './identifiers';

describe('normalizePhone', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['+84 912 345 678', '0912345678'],
    ['84912345678', '0912345678'],
    ['0912.345.678', '0912345678'],
    ['(091) 234-5678', '0912345678'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it('leaves a short number starting with 84 alone', () => {
    expect(normalizePhone('8412')).toBe('8412');
  });

  it('PHONE_PATTERN accepts 10–11 digit local numbers only', () => {
    expect(PHONE_PATTERN.test('0912345678')).toBe(true);
    expect(PHONE_PATTERN.test('912345678')).toBe(false);
    expect(PHONE_PATTERN.test('09123')).toBe(false);
  });
});

describe('parseIdentifier', () => {
  it('treats anything with @ as an email, lower-cased', () => {
    expect(parseIdentifier('  An.Nguyen@Example.COM ')).toEqual({ email: 'an.nguyen@example.com' });
  });
  it('treats the rest as a phone number', () => {
    expect(parseIdentifier('+84912345678')).toEqual({ phone: '0912345678' });
  });
});
