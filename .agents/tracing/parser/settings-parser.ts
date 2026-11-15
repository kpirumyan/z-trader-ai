import type { ParsedSettingsChange } from "../types.ts";

const ANTIGRAVITY_SETTINGS_REGEX =
  /The user changed setting `([^`]+)`\s+(?:from\s+(.+?)\s+)?to\s+(.+?)(?:\.(?=\s|$)|$)/gi;
const GENERIC_SETTINGS_REGEX =
  /^([A-Za-z0-9 _-]+?)\s+changed\s+(?:from\s+(.+?)\s+)?to\s+(.+?)(?:\.(?=\s|$)|$)/i;

/**
 * Normalizes a human-readable model display name (e.g. `Gemini 3.8 Flash (High)`)
 * into a lowercase hyphenated model identifier (`gemini-3.8-flash-high`).
 */
export function normalizeModelIdentifier(displayName: string): string | undefined {
  const trimmed = displayName.trim();

  if (!trimmed || /^none$/i.test(trimmed)) {
    return undefined;
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/[()[\]]+/g, " ")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || undefined;
}

function buildParsedSettingsChange(
  setting: string,
  from: string | undefined,
  to: string,
  raw: string,
): ParsedSettingsChange {
  const cleanSetting = setting.trim();
  const cleanFrom = from?.trim() || undefined;
  const cleanTo = to.trim();
  const isModelSetting = /^model(?:\s*selection)?$/i.test(cleanSetting);
  const normalizedModel = isModelSetting ? normalizeModelIdentifier(cleanTo) : undefined;

  return {
    setting: cleanSetting,
    ...(cleanFrom ? { from: cleanFrom } : {}),
    to: cleanTo,
    raw: raw.trim(),
    ...(normalizedModel ? { normalizedModel } : {}),
  };
}

/**
 * Parses one or more `<USER_SETTINGS_CHANGE>` entries into structured setting updates.
 */
export function parseUserSettingsChanges(rawSettingsChange: string): ParsedSettingsChange[] {
  const trimmed = rawSettingsChange.trim();

  if (!trimmed) {
    return [];
  }

  const results: ParsedSettingsChange[] = [];
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    let matchedInLine = false;

    ANTIGRAVITY_SETTINGS_REGEX.lastIndex = 0;

    for (const match of line.matchAll(ANTIGRAVITY_SETTINGS_REGEX)) {
      if (match[1] && match[3]) {
        results.push(buildParsedSettingsChange(match[1], match[2], match[3], match[0]));
        matchedInLine = true;
      }
    }

    if (matchedInLine) {
      continue;
    }

    const genericMatch = line.match(GENERIC_SETTINGS_REGEX);

    if (genericMatch?.[1] && genericMatch[3]) {
      results.push(
        buildParsedSettingsChange(genericMatch[1], genericMatch[2], genericMatch[3], line),
      );

      continue;
    }

    results.push({
      setting: "unknown",
      to: line,
      raw: line,
    });
  }

  return results;
}
