import { detectFileType } from './file-type';

describe('detectFileType', () => {
  it('knows PDF, JPEG and PNG by their first bytes', () => {
    expect(detectFileType(Buffer.from('%PDF-1.7\n...'))).toEqual({ mime: 'application/pdf', ext: 'pdf' });
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ mime: 'image/png', ext: 'png' });
  });

  it('refuses everything else, whatever it is called', () => {
    expect(detectFileType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectFileType(Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});
