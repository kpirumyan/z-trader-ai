import type { SafeStorage } from "./types";
import type { z } from "zod";

function getBrowserStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }

  return null;
}

function verifyStorageAvailability(storage: Storage | null): boolean {
  if (!storage) {
    return false;
  }

  try {
    const probeKey = "__safe_storage_probe__";

    storage.setItem(probeKey, probeKey);
    storage.removeItem(probeKey);

    return true;
  } catch {
    return false;
  }
}

export function createSafeStorage(storage?: Storage | null): SafeStorage {
  const memoryMap = new Map<string, string>();
  const rawStorage = storage !== undefined ? storage : getBrowserStorage();
  const isAvailable = verifyStorageAvailability(rawStorage);

  const getItem = (key: string): string | null => {
    if (memoryMap.has(key)) {
      return memoryMap.get(key) ?? null;
    }

    if (rawStorage) {
      try {
        const value = rawStorage.getItem(key);

        if (value !== null) {
          return value;
        }
      } catch {
        return memoryMap.get(key) ?? null;
      }
    }

    return memoryMap.get(key) ?? null;
  };

  const setItem = (key: string, value: string): boolean => {
    if (isAvailable && rawStorage) {
      try {
        rawStorage.setItem(key, value);
        memoryMap.delete(key);

        return true;
      } catch {
        memoryMap.set(key, value);

        return true;
      }
    }

    memoryMap.set(key, value);

    return true;
  };

  const removeItem = (key: string): boolean => {
    if (rawStorage) {
      try {
        rawStorage.removeItem(key);
      } catch {
        // ignore
      }
    }

    memoryMap.delete(key);

    return true;
  };

  const clear = (): boolean => {
    if (rawStorage) {
      try {
        rawStorage.clear();
      } catch {
        // ignore
      }
    }

    memoryMap.clear();

    return true;
  };

  const getJSON = <T>(key: string, schema?: z.ZodType<T>, fallback?: T): T | null => {
    const fallbackValue = fallback ?? null;
    const raw = getItem(key);

    if (raw === null) {
      return fallbackValue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      return fallbackValue;
    }

    if (schema) {
      const result = schema.safeParse(parsed);

      if (!result.success) {
        return fallbackValue;
      }

      return result.data;
    }

    return parsed as T;
  };

  const setJSON = <T>(key: string, value: T): boolean => {
    let serialized: string;

    try {
      serialized = JSON.stringify(value);
    } catch {
      return false;
    }

    if (typeof serialized !== "string") {
      return false;
    }

    return setItem(key, serialized);
  };

  return {
    getItem,
    setItem,
    removeItem,
    clear,
    getJSON,
    setJSON,
  };
}

export const safeStorage: SafeStorage = createSafeStorage();
