import type { z } from "zod";

export interface SafeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): boolean;
  removeItem(key: string): boolean;
  clear(): boolean;
  getJSON<T>(key: string, schema?: z.ZodType<T>, fallback?: T): T | null;
  setJSON<T>(key: string, value: T): boolean;
}
