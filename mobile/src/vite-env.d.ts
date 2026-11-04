/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  /** "1" only when android/app/google-services.json is in the build (see lib/push.ts). */
  readonly VITE_PUSH_ENABLED?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
