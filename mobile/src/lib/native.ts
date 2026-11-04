import { Camera, CameraDirection, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

/**
 * A photo taken now with the camera — never picked from the gallery. On a phone this is the native camera;
 * in a browser (development) an <input capture> stands in.
 */
export async function takePhoto(side: 'front' | 'rear'): Promise<Blob> {
  if (!Capacitor.isNativePlatform()) return pickInBrowser(side);
  let webPath: string | undefined;
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      direction: side === 'front' ? CameraDirection.Front : CameraDirection.Rear,
      resultType: CameraResultType.Uri,
      quality: 60,
      width: 1280,
      allowEditing: false,
      saveToGallery: false,
    });
    webPath = photo.webPath;
  } catch (error) {
    const text = String((error as Error)?.message ?? '').toLowerCase();
    if (text.includes('cancel')) throw new Error('Đã huỷ chụp ảnh');
    if (text.includes('permission') || text.includes('denied') || text.includes('access')) {
      throw new Error('Cần cho phép IntelShield dùng camera (Cài đặt → Ứng dụng → IntelShield → Quyền)');
    }
    throw new Error('Không mở được camera — thử lại');
  }
  return (await fetch(webPath!)).blob();
}

function pickInBrowser(side: 'front' | 'rear'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png';
    input.setAttribute('capture', side === 'front' ? 'user' : 'environment');
    input.onchange = () => (input.files?.[0] ? resolve(input.files[0]) : reject(new Error('Chưa chụp ảnh')));
    input.click();
  });
}

export interface Fix {
  lat: number;
  lng: number;
  accuracy_m: number;
}

/** Where the phone is now. Asks for permission the first time; fails with a message the guard can act on. */
export async function getPosition(): Promise<Fix> {
  if (Capacitor.isNativePlatform()) {
    const allowed = (p: { location: string; coarseLocation: string }) => p.location === 'granted' || p.coarseLocation === 'granted';
    let perm;
    try {
      perm = await Geolocation.checkPermissions();
    } catch {
      throw new Error('GPS đang tắt — bật Vị trí trên điện thoại rồi thử lại');
    }
    if (!allowed(perm)) {
      const asked = await Geolocation.requestPermissions({ permissions: ['location'] });
      if (!allowed(asked)) throw new Error('Cần cho phép IntelShield dùng vị trí (Cài đặt → Ứng dụng → IntelShield → Quyền)');
    }
  }
  try {
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 });
    return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) };
  } catch {
    throw new Error('Chưa lấy được vị trí — bật GPS và đứng ở chỗ thoáng rồi thử lại');
  }
}
