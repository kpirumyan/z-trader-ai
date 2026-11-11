const MODULE_PATH_REGEX = /(?:^|\/)src\/modules\/([a-zA-Z0-9_-]+)(?:\/|$)/g;
const SKILL_PATH_REGEX = /(?:^|\/)(?:\.agents\/)?skills\/([a-zA-Z0-9_-]+)(?:\/|$)/g;

export function collectTagsFromValue(value: unknown, tagSet: Set<string>): void {
  if (typeof value === "string") {
    const normalized = value.replace(/\\/g, "/");

    for (const match of normalized.matchAll(MODULE_PATH_REGEX)) {
      if (match[1]) {
        tagSet.add(`module:${match[1]}`);
      }
    }

    for (const match of normalized.matchAll(SKILL_PATH_REGEX)) {
      if (match[1]) {
        tagSet.add(`skill:${match[1]}`);
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
