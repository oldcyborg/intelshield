import { newQrSecret, parseQr, qrMatches, qrPayload } from './qr';

const ID = '3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60';

describe('QR tags', () => {
  it('round-trips a signed payload', () => {
    const secret = newQrSecret();
    const payload = qrPayload(secret, ID);
    expect(payload).toMatch(/^PTR1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/);
    const parsed = parseQr(payload)!;
    expect(parsed.checkpointId).toBe(ID);
    expect(qrMatches(secret, parsed.checkpointId, parsed.signature)).toBe(true);
  });

  it('rejects a tampered signature, another secret, and junk', () => {
    const secret = newQrSecret();
    const parsed = parseQr(qrPayload(secret, ID))!;
    const flipped = (parsed.signature[0] === 'A' ? 'B' : 'A') + parsed.signature.slice(1);
    expect(qrMatches(secret, ID, flipped)).toBe(false);
    expect(qrMatches(newQrSecret(), ID, parsed.signature)).toBe(false);
    expect(parseQr('https://example.com')).toBeNull();
    expect(parseQr(`PTR1.not-a-uuid.${parsed.signature}`)).toBeNull();
    expect(parseQr(`PTR1.${ID}.short`)).toBeNull();
  });
});
