import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';

/** The phone's identity as the backend binds it: one approved phone per guard. */
export async function getDeviceInfo(): Promise<{ device_id: string; platform: string; label: string }> {
  const [{ identifier }, info] = await Promise.all([Device.getId(), Device.getInfo()]);
  return {
    device_id: identifier,
    platform: Capacitor.getPlatform(),
    label: [info.manufacturer, info.model].filter(Boolean).join(' ') || 'Máy không rõ tên',
  };
}
