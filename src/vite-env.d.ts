/// <reference types="vite/client" />

// Injected by vite.config.ts at build time — short build/commit id.
declare const __APP_BUILD__: string;

interface ImportMetaEnv {
  readonly VITE_VIATOR_FN_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
