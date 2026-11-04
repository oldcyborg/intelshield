import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { PUSH_ENABLED } from '../config';
import { ApiClient } from './api';

/**
 * Phone notifications through Firebase. `onTap` gets the notification's data to open the right screen.
 *
 * Without google-services.json there is no FirebaseApp, and the plugin's register()/unregister() call
 * FirebaseMessaging.getInstance(), which throws IllegalStateException on the native side. That is not a
 * rejected promise the try/catch below can see: it kills the process. So nothing here touches the plugin
 * unless the build was made with VITE_PUSH_ENABLED=1, and the permission is not even asked for — asking
 * for notifications that can never arrive is a promise the app cannot keep. The in-app inbox still works.
 */
let registered = false;

export async function registerPush(api: ApiClient, onTap: (data: Record<string, string>) => void, onArrive: () => void): Promise<void> {
  if (!PUSH_ENABLED || !Capacitor.isNativePlatform() || registered) return;
  registered = true;
  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return;
    await PushNotifications.createChannel({ id: 'critical', name: 'Khẩn cấp — SOS', importance: 5, visibility: 1, vibration: true, sound: 'default' });
    await PushNotifications.createChannel({ id: 'default', name: 'Thông báo', importance: 3, visibility: 1 });
    await PushNotifications.removeAllListeners();
    await PushNotifications.addListener('registration', (t) => {
      api.request('/me/push-token', { json: { token: t.value } }).catch(() => undefined);
    });
    await PushNotifications.addListener('pushNotificationReceived', () => onArrive());
    await PushNotifications.addListener('pushNotificationActionPerformed', (a) => onTap((a.notification.data ?? {}) as Record<string, string>));
    await PushNotifications.register();
  } catch {
    // No Firebase configuration in this build: in-app notifications only.
  }
}

/** On sign-out: this phone stops receiving the previous person's notifications. */
export async function unregisterPush(): Promise<void> {
  registered = false;
  if (!PUSH_ENABLED || !Capacitor.isNativePlatform()) return;
  try {
    await PushNotifications.removeAllListeners();
    await PushNotifications.unregister();
  } catch {
    // Nothing registered.
  }
}
