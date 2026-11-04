import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { Capacitor } from '@capacitor/core';

/**
 * Read a QR tag with Google's scanner (no camera permission of our own). The first time on a phone the scanner
 * module is downloaded by Google Play services; until then this asks to try again in a moment.
 */
export async function scanQr(): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    const typed = window.prompt('Thử trên trình duyệt: dán nội dung mã QR');
    if (!typed) throw new Error('Đã huỷ quét');
    return typed;
  }
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (!available) {
    await BarcodeScanner.installGoogleBarcodeScannerModule().catch(() => undefined);
    throw new Error('Đang tải trình quét mã lần đầu (cần mạng) — chờ vài giây rồi bấm quét lại');
  }
  try {
    const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
    const value = barcodes[0]?.rawValue ?? barcodes[0]?.displayValue;
    if (!value) throw new Error('Không đọc được mã — thử lại');
    return value;
  } catch (error) {
    const text = String((error as Error)?.message ?? '').toLowerCase();
    if (text.includes('cancel')) throw new Error('Đã huỷ quét');
    throw error instanceof Error && !text.includes('scan') ? error : new Error('Không quét được mã — thử lại');
  }
}
