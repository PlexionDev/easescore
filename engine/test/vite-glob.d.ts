// Types for Vite's import.meta.glob (used by vitest) without pulling in vite/client or @types/node.
interface ImportMeta {
  glob<T = unknown>(pattern: string | string[], options?: { eager?: boolean; query?: string; import?: string }): Record<string, T>;
}
