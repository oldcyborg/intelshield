const SIGNATURES: { bytes: number[]; mime: string; ext: string }[] = [
  { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], mime: 'application/pdf', ext: 'pdf' }, // %PDF-
  { bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg', ext: 'jpg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mime: 'image/png', ext: 'png' },
];

/** The type a file really is, from its first bytes. Names and Content-Type headers are the uploader's claims. */
export function detectFileType(buffer: Buffer): { mime: string; ext: string } | null {
  const match = SIGNATURES.find((s) => s.bytes.every((b, i) => buffer[i] === b));
  return match ? { mime: match.mime, ext: match.ext } : null;
}
