import { beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({
  checkPermissions: vi.fn(async () => ({ receive: 'prompt' })),
  requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
  createChannel: vi.fn(async () => undefined),
  removeAllListeners: vi.fn(async () => undefined),
  addListener: vi.fn(async () => ({ remove: async () => undefined })),
  register: vi.fn(async () => undefined),
  unregister: vi.fn(async () => undefined),
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));

describe('push without Firebase', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(plugin).forEach((f) => f.mockClear());
  });

  it('never touches the native plugin when the build has no Firebase', async () => {
    vi.doMock('../config', () => ({ PUSH_ENABLED: false }));
    const { registerPush, unregisterPush } = await import('./push');
    await registerPush({ request: vi.fn() } as never, () => undefined, () => undefined);
    await unregisterPush();
    // register()/unregister() crash the process natively without a FirebaseApp (not a rejected promise).
    for (const f of Object.values(plugin)) expect(f).not.toHaveBeenCalled();
  });

  it('registers and unregisters when the build enables push', async () => {
    vi.doMock('../config', () => ({ PUSH_ENABLED: true }));
    const { registerPush, unregisterPush } = await import('./push');
    await registerPush({ request: vi.fn() } as never, () => undefined, () => undefined);
    expect(plugin.register).toHaveBeenCalledTimes(1);
    await unregisterPush();
    expect(plugin.unregister).toHaveBeenCalledTimes(1);
  });
});
