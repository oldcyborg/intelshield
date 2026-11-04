import type { CapacitorConfig } from '@capacitor/cli';

/**
 * IntelShield — one app for guards, team leaders and managers; screens follow permissions.
 * MOBILE_DEV=1 builds a test APK that may call a plain-HTTP backend on the office LAN;
 * a release build only talks to the HTTPS backend.
 */
const dev = process.env.MOBILE_DEV === '1';

const config: CapacitorConfig = {
  appId: 'io.github.oldcyborg.intelshield',
  appName: 'IntelShield',
  webDir: 'dist',
  android: {
    allowMixedContent: dev,
  },
  server: {
    androidScheme: 'https',
    cleartext: dev,
  },
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
