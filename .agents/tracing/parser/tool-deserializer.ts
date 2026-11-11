export function deserializeToolArgs(
  rawArgs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!rawArgs) {
    return {};
  }

  const deserialized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rawArgs)) {
    if (typeof value !== "string") {
      deserialized[key] = value;
      continue;
    }

    const trimmed = value.trim();
    const looksJsonEncoded =
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      trimmed === "true" ||
      trimmed === "false" ||
      trimmed === "null" ||
      /^-?\d+(?:\.\d+)?$/.test(trimmed);

    if (looksJsonEncoded) {
      try {
        deserialized[key] = JSON.parse(trimmed) as unknown;
        continue;
      } catch {
        // Fallback to raw string when JSON parsing fails
      }
    }

    deserialized[key] = value;
  }

  return deserialized;
}
