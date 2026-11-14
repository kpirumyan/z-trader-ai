const MODULE_PATH_REGEX = /(?:^|[/\s"'])src\/modules\/([a-zA-Z0-9_-]+)(?=[/\s"']|$)/g;

const TARGET_TAG_ARG_KEYS = new Set([
  "Path",
  "path",
  "file_path",
  "TargetFile",
  "AbsolutePath",
  "Directory",
  "SearchPath",
  "SearchDirectory",
  "CommandLine",
  "commandLine",
  "command",
  "files",
  "paths",
]);

/**
 * Extracts `module:<name>` tags from strings, arrays, or nested objects.
 */
export function collectTagsFromValue(value: unknown, tagSet: Set<string>): void {
  if (typeof value === "string") {
    const normalized = value.replace(/\\/g, "/");

    for (const match of normalized.matchAll(MODULE_PATH_REGEX)) {
      if (match[1]) {
        tagSet.add(`module:${match[1]}`);
      }
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTagsFromValue(item, tagSet);
    }

    return;
  }

  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) {
      collectTagsFromValue(nested, tagSet);
    }
  }
}

/**
 * Collects `module:<name>` tags strictly from path and command arguments
 * so prose fields (`Content`, `Prompt`, `Replacement`, etc.) do not cause false positives.
 */
export function collectModuleTagsFromToolArgs(
  deserializedArgs: Record<string, unknown>,
  tagSet: Set<string>,
): void {
  for (const [key, value] of Object.entries(deserializedArgs)) {
    if (TARGET_TAG_ARG_KEYS.has(key)) {
      collectTagsFromValue(value, tagSet);
    }
  }
}
