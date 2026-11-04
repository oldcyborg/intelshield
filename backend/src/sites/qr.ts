import { isUUID } from 'class-validator';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * A printed tag reads `PTR1.<checkpoint id>.<signature>`. The signature is an
 * HMAC under a secret only the backend knows, so nobody can print a tag for a
 * checkpoint they invented; re-printing rotates the secret and kills old tags.
 * A photo of a genuine tag still scans — GPS, photos and timing catch that (spec §7.3).
 */
export const QR_PREFIX = 'PTR1';
const SIGNATURE_LENGTH = 22; // 132 bits of base64url

export const newQrSecret = () => randomBytes(32).toString('hex');

export function qrSignature(secret: string, checkpointId: string): string {
  return createHmac('sha256', secret).update(checkpointId).digest('base64url').slice(0, SIGNATURE_LENGTH);
}

export function qrPayload(secret: string, checkpointId: string): string {
  return `${QR_PREFIX}.${checkpointId}.${qrSignature(secret, checkpointId)}`;
}

export function parseQr(payload: string): { checkpointId: string; signature: string } | null {
  const parts = payload.trim().split('.');
  if (parts.length !== 3 || parts[0] !== QR_PREFIX || !isUUID(parts[1]) || parts[2].length !== SIGNATURE_LENGTH) return null;
  return { checkpointId: parts[1], signature: parts[2] };
}

export function qrMatches(secret: string, checkpointId: string, signature: string): boolean {
  const expected = Buffer.from(qrSignature(secret, checkpointId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
