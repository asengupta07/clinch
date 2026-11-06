/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_DEPLOYMENTS?: string;
  readonly VITE_EXPLORER_URL?: string;
  readonly VITE_ANON_RPC_SPECIFIER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __DEPLOYMENTS__: Record<string, string | number>;
