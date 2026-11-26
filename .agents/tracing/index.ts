export { runStopHook } from "./exporter.ts";
export { createTurnTraceId } from "./observations.ts";
export { runSessionStartHook } from "./session-start-hook.ts";
export { discoverAvailableSkills } from "./skills.ts";
export { computeContextAnchor } from "./versioning.ts";

export {
  acquireSpoolLock,
  advanceCursorForTurns,
  getSpoolFilePath,
  listSpoolFiles,
  mergeTurnsForExport,
  readCursorState,
  readPendingSpool,
  readSpoolEntry,
  readSubagentLink,
  releaseSpoolLock,
  removeSpoolFile,
  resolveSpoolDir,
  writeCursorState,
  writePendingSpool,
} from "./spool/index.ts";

export {
  DEFAULT_TIMEOUT_MS,
  LINK_ANCHOR_SPAN_NAME,
  createNoopSpanExporter,
} from "./instrumentation.ts";

export {
  buildSyntheticToolCallId,
  classifySystemMessageName,
  classifyToolCall,
  collectModuleTagsFromToolArgs,
  collectTagsFromValue,
  createFilesystemSubagentResolver,
  deriveSubagentObservationName,
  deserializeToolArgs,
  extractGenericTimingAndBody,
  extractParentConversationFromTranscript,
  extractSubagentConversationId,
  extractSystemMessageContent,
  extractUserRequest,
  isClientMetaCommand,
  isSubagentToolCall,
  matchSkillFilePath,
  normalizeModelIdentifier,
  parseIsoTimestamp,
  parseJsonlSteps,
  parseTranscriptTurns,
  parseUserSettingsChanges,
  resolveFullTranscriptPath,
} from "./parser/index.ts";

export type {
  ParsedSettingsChange,
  ParsedTurnTrace,
  SessionStartHookInput,
  StopHookInput,
  TurnGateSummary,
} from "./types.ts";
