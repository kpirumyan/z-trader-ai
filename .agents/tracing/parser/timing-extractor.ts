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

  let body = rawContent;
  let firstStartTime: Date | null = null;
  let lastEndTime: Date | null = null;

  while (true) {
    const match = body.match(CREATED_AT_HEADER_REGEX);

    if (!match) {
      break;
    }

    const currentStart = parseIsoTimestamp(match[1]?.trim(), stepCreatedAt);
    const rawEnd = parseIsoTimestamp(match[2]?.trim(), currentStart);
    const currentEnd = rawEnd.getTime() >= currentStart.getTime() ? rawEnd : currentStart;

    if (!firstStartTime) {
      firstStartTime = currentStart;
    }

    lastEndTime = currentEnd;
    body = body.slice(match[0].length);
  }

  const startTime = firstStartTime ?? stepCreatedAt;
  const rawLastEnd = lastEndTime ?? startTime;
  const endTime = rawLastEnd.getTime() >= startTime.getTime() ? rawLastEnd : startTime;
  const cleanBody = body.trim();

  return {
    startTime,
    endTime,
    cleanBody,
  };
}
