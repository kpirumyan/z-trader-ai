import fs from "node:fs";
import path from "node:path";

import type { RawTranscriptStep } from "../types.ts";

export function resolveFullTranscriptPath(transcriptPath: string): string {
  const dir = path.dirname(transcriptPath);
  const fullCandidate = path.join(dir, "transcript_full.jsonl");

  if (fs.existsSync(fullCandidate)) {
    return fullCandidate;
  }

  return transcriptPath;
}

export function parseJsonlSteps(jsonlContent: string): RawTranscriptStep[] {
  const lines = jsonlContent.split(/\r?\n/);
  const steps: RawTranscriptStep[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as RawTranscriptStep;

      if (typeof parsed.step_index === "number" && typeof parsed.type === "string") {
        steps.push(parsed);
      }
    } catch {
      // Skip malformed or incomplete trailing JSONL lines
    }
  }

  return steps.sort((a, b) => a.step_index - b.step_index);
}
