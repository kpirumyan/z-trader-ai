import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createSafeStorage, safeStorage } from "@/src/shared/storage";

describe("shared-storage", () => {
  beforeEach(() => {
    safeStorage.clear();
  });

  describe("Low-Level String Storage Operations", () => {
    it("stores, retrieves, and removes string values successfully", () => {
      // Given
      const key = "key1";
      const value = "val1";

      // When
      const setResult = safeStorage.setItem(key, value);
      const retrievedValue = safeStorage.getItem(key);
      const removeResult = safeStorage.removeItem(key);
      const valueAfterRemoval = safeStorage.getItem(key);

      // Then
      expect(setResult).toBe(true);
      expect(retrievedValue).toBe("val1");
      expect(removeResult).toBe(true);
      expect(valueAfterRemoval).toBeNull();
    });

    it("returns null when attempting to get a non-existent key", () => {
      // Given
      const nonExistentKey = "unregistered_key";

      // When
      const result = safeStorage.getItem(nonExistentKey);

      // Then
      expect(result).toBeNull();
    });
  });

  describe("Graceful In-Memory Fallback on Quota or Security Errors", () => {
    it("falls back to in-memory store when storage setItem throws QuotaExceededError", () => {
      // Given
      const quotaStorage: Storage = {
        getItem: () => null,
        setItem: () => {
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        },
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      };

      const storage = createSafeStorage(quotaStorage);

      // When
      const setResult = storage.setItem("quotaKey", "importantData");
      const retrievedValue = storage.getItem("quotaKey");

      // Then
      expect(setResult).toBe(true);
      expect(retrievedValue).toBe("importantData");
    });

    it("falls back to in-memory store when storage throws SecurityError during probe", () => {
      // Given: A restricted environment (e.g. Safari Private Mode / blocked cookies)
      const restrictedStorage: Storage = {
        getItem: () => {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
        setItem: () => {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      };

      // When
      const storage = createSafeStorage(restrictedStorage);
      const setResult = storage.setItem("secKey", "secureData");
      const retrievedValue = storage.getItem("secKey");

      // Then
      expect(setResult).toBe(true);
      expect(retrievedValue).toBe("secureData");
    });
  });

  describe("SSR and Missing Window Storage Safety", () => {
    it("operates safely using in-memory fallback when null storage is provided (SSR simulation)", () => {
      // Given: Storage initialized without window / localStorage available
      const ssrStorage = createSafeStorage(null);

      // When
      const setResult = ssrStorage.setItem("ssrKey", "ssrVal");
      const retrievedValue = ssrStorage.getItem("ssrKey");
      const removeResult = ssrStorage.removeItem("ssrKey");
      const valueAfterRemoval = ssrStorage.getItem("ssrKey");

      // Then
      expect(setResult).toBe(true);
      expect(retrievedValue).toBe("ssrVal");
      expect(removeResult).toBe(true);
      expect(valueAfterRemoval).toBeNull();
    });
  });

  describe("High-Level getJSON with Valid Zod Schema", () => {
    const windowStateSchema = z.object({
      id: z.string(),
      x: z.number(),
    });

    it("parses valid JSON data and validates against Zod schema", () => {
      // Given
      const key = "win-key";
      const validPayload = { id: "win-1", x: 100 };

      safeStorage.setItem(key, JSON.stringify(validPayload));

      // When
      const result = safeStorage.getJSON(key, windowStateSchema);

      // Then
      expect(result).toEqual(validPayload);
    });

    it("parses valid JSON data without schema when schema is omitted", () => {
      // Given
      const key = "raw-json-key";
      const validPayload = { hello: "world", count: 42 };

      safeStorage.setItem(key, JSON.stringify(validPayload));

      // When
      const result = safeStorage.getJSON<typeof validPayload>(key);

      // Then
      expect(result).toEqual(validPayload);
    });

    it("returns null or fallback when key does not exist", () => {
      // Given
      const missingKey = "non-existent-json";
      const fallback = { id: "default", x: 0 };

      // When
      const resultWithoutFallback = safeStorage.getJSON(missingKey, windowStateSchema);
      const resultWithFallback = safeStorage.getJSON(missingKey, windowStateSchema, fallback);

      // Then
      expect(resultWithoutFallback).toBeNull();
      expect(resultWithFallback).toEqual(fallback);
    });
  });

  describe("High-Level getJSON with Corrupted JSON Data", () => {
    const itemSchema = z.object({
      name: z.string(),
    });

    it("returns fallback value when storage contains malformed JSON", () => {
      // Given
      const key = "bad-json";

      safeStorage.setItem(key, "{{invalid-json");

      const fallbackValue = { name: "fallback" };

      // When
      const resultWithFallback = safeStorage.getJSON(key, itemSchema, fallbackValue);
      const resultWithoutFallback = safeStorage.getJSON(key, itemSchema);

      // Then
      expect(resultWithFallback).toEqual(fallbackValue);
      expect(resultWithoutFallback).toBeNull();
    });
  });

  describe("High-Level getJSON with Schema Validation Failure", () => {
    const userSchema = z.object({
      id: z.string(),
      age: z.number(),
    });

    it("returns fallback value when stored JSON violates schema requirements", () => {
      // Given
      const key = "schema-mismatch";

      safeStorage.setItem(key, JSON.stringify({ id: 123, age: "twenty" }));

      const fallbackValue = { id: "default-id", age: 0 };

      // When
      const resultWithFallback = safeStorage.getJSON(key, userSchema, fallbackValue);
      const resultWithoutFallback = safeStorage.getJSON(key, userSchema);

      // Then
      expect(resultWithFallback).toEqual(fallbackValue);
      expect(resultWithoutFallback).toBeNull();
    });
  });

  describe("High-Level setJSON with Circular Object", () => {
    it("returns false and avoids unhandled errors when serializing circular objects", () => {
      // Given
      const circularObj: Record<string, unknown> = { name: "root" };

      circularObj.self = circularObj;

      // When
      const result = safeStorage.setJSON("circular", circularObj);

      // Then
      expect(result).toBe(false);
      expect(safeStorage.getItem("circular")).toBeNull();
    });

    it("successfully serializes and saves valid objects", () => {
      // Given
      const validData = { settings: { theme: "dark", volume: 80 } };

      // When
      const setResult = safeStorage.setJSON("app-settings", validData);
      const retrieved = safeStorage.getJSON<typeof validData>("app-settings");

      // Then
      expect(setResult).toBe(true);
      expect(retrieved).toEqual(validData);
    });
  });

  describe("Clear Operation Purging Both Storage and Memory", () => {
    it("purges data from both underlying storage and in-memory fallback", () => {
      // Given: An underlying storage that succeeds for normal key but throws on second key (going to in-memory)
      const storageMap = new Map<string, string>();
      const hybridStorage: Storage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (k === "overflowKey") {
            throw new DOMException("QuotaExceededError", "QuotaExceededError");
          }

          storageMap.set(k, v);
        },
        removeItem: (k: string) => {
          storageMap.delete(k);
        },
        clear: () => {
          storageMap.clear();
        },
        key: () => null,
        length: 0,
      };

      const storage = createSafeStorage(hybridStorage);

      storage.setItem("normalKey", "normalVal");
      storage.setItem("overflowKey", "overflowVal");

      expect(storage.getItem("normalKey")).toBe("normalVal");
      expect(storage.getItem("overflowKey")).toBe("overflowVal");

      // When
      const clearResult = storage.clear();

      // Then
      expect(clearResult).toBe(true);
      expect(storage.getItem("normalKey")).toBeNull();
      expect(storage.getItem("overflowKey")).toBeNull();
    });
  });
});
