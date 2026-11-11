const CREATED_AT_HEADER_REGEX = /^Created At:\s*([^\r\n]+)\r?\nCompleted At:\s*([^\r\n]+)\r?\n?/;

export function parseIsoTimestamp(raw: string | undefined, fallback: Date): Date {
  if (!raw) {
    return fallback;
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed;
}

export function extractGenericTimingAndBody(
  rawContent: string | undefined,
  stepCreatedAt: Date,
): { startTime: Date; endTime: Date; cleanBody: string } {
  if (!rawContent) {
    return {
      startTime: stepCreatedAt,
      endTime: stepCreatedAt,
      cleanBody: "",
    };
  }

  const match = rawContent.match(CREATED_AT_HEADER_REGEX);

  if (!match) {
    return {
      startTime: stepCreatedAt,
      endTime: stepCreatedAt,
      cleanBody: rawContent.trim(),
    };
  }

  const startTime = parseIsoTimestamp(match[1]?.trim(), stepCreatedAt);
  const rawEndTime = parseIsoTimestamp(match[2]?.trim(), startTime);
  const endTime = rawEndTime.getTime() >= startTime.getTime() ? rawEndTime : startTime;
  const cleanBody = rawContent.slice(match[0].length).trim();

  return {
    startTime,
    endTime,
    cleanBody,
  };
}
