#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CANONICAL_H2_SECTIONS = [
  "## Context and Problem Statement",
  "## Decision Drivers",
  "## Decision Outcome",
  "## Confirmation and Enforcement",
  "## Consequences",
  "## Rejected Alternatives",
];

const FORBIDDEN_BYPASS_FLAGS = new Set([
  "--force",
  "-f",
  "--allow-edit",
  "--update-hash",
  "--bypass",
  "--skip-lock",
  "--no-lock",
]);

const VALID_STATIC_STATUSES = new Set(["proposed", "accepted", "rejected", "deprecated"]);
const SUPERSEDED_STATUS_REGEX = /^superseded by (ADR-\d{4})$/;
const ADR_FILENAME_REGEX = /^(\d{4})-([a-z0-9-]+)\.md$/;
const ADR_ID_REGEX = /^ADR-(\d{4})$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeLf(text) {
  return text.replace(/\r\n/g, "\n");
}

export function normalizeRepoPath(p) {
  return String(p || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

export function normalizeAdrId(rawId) {
  const trimmed = String(rawId || "").trim().toUpperCase();

  if (ADR_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  const digitsMatch = trimmed.match(/^(?:ADR-)?(\d{1,4})$/);

  if (digitsMatch) {
    return `ADR-${digitsMatch[1].padStart(4, "0")}`;
  }

  throw new Error(`Invalid ADR identifier: "${rawId}". Expected format "ADR-XXXX" or "XXXX".`);
}

export function slugifyTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function isActiveStatus(status) {
  return status === "accepted" || status === "proposed";
}

export function isValidStatus(status) {
  return VALID_STATIC_STATUSES.has(status) || SUPERSEDED_STATUS_REGEX.test(status);
}

export function extractBodyAfterFrontmatter(rawContent) {
  const normalized = normalizeLf(rawContent);

  return normalized.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
}

export function computeBodyHash(rawContentOrBody) {
  const body = extractBodyAfterFrontmatter(rawContentOrBody);

  return crypto.createHash("sha256").update(body, "utf8").digest("hex");
}

function unquoteYamlScalar(raw) {
  const trimmed = raw.trim();

  if (trimmed === "null" || trimmed === "~" || trimmed === "") {
    return null;
  }

  if (trimmed === "[]") {
    return [];
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1);
      }
    }

    return trimmed.slice(1, -1);
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();

    if (!inner) {
      return [];
    }

    return inner.split(",").map((part) => String(unquoteYamlScalar(part) ?? "").trim());
  }

  return trimmed;
}

export function parseFrontmatterAndBody(rawContent) {
  const normalized = normalizeLf(rawContent);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    throw new Error("Missing or malformed YAML frontmatter block delimited by '---'.");
  }

  const yamlText = match[1];
  const body = match[2].trim();
  const frontmatter = {};
  const lines = yamlText.split("\n");
  let currentListKey = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }

    const listMatch = line.match(/^\s*-\s+(.*)$/);

    if (listMatch) {
      if (!currentListKey) {
        throw new Error(`Unexpected YAML list item at line ${i + 2}: "${line}"`);
      }

      const itemVal = unquoteYamlScalar(listMatch[1]);

      if (itemVal !== null && itemVal !== "") {
        frontmatter[currentListKey].push(String(itemVal));
      }

      continue;
    }

    const kvMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);

    if (!kvMatch) {
      throw new Error(`Invalid YAML frontmatter syntax at line ${i + 2}: "${line}"`);
    }

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();

    if (rawValue === "") {
      frontmatter[key] = [];
      currentListKey = key;
    } else {
      frontmatter[key] = unquoteYamlScalar(rawValue);
      currentListKey = null;
    }
  }

  return { frontmatter, body };
}

export function serializeFrontmatter(fm) {
  const lines = ["---"];

  lines.push(`id: ${JSON.stringify(fm.id)}`);
  lines.push(`title: ${JSON.stringify(fm.title)}`);
  lines.push(`status: ${JSON.stringify(fm.status)}`);
  lines.push(`date: ${JSON.stringify(fm.date)}`);

  const decisionMakers = Array.isArray(fm["decision-makers"]) ? fm["decision-makers"] : [];

  if (decisionMakers.length === 0) {
    lines.push("decision-makers: []");
  } else {
    lines.push("decision-makers:");

    for (const dm of decisionMakers) {
      lines.push(`  - ${JSON.stringify(dm)}`);
    }
  }

  lines.push(`area: ${JSON.stringify(fm.area)}`);

  const appliesTo = Array.isArray(fm.applies_to) ? fm.applies_to : [];

  if (appliesTo.length === 0) {
    lines.push("applies_to: []");
  } else {
    lines.push("applies_to:");

    for (const p of appliesTo) {
      lines.push(`  - ${JSON.stringify(normalizeRepoPath(p))}`);
    }
  }

  const enforcedBy = Array.isArray(fm.enforced_by) ? fm.enforced_by : [];

  if (enforcedBy.length === 0) {
    lines.push("enforced_by: []");
  } else {
    lines.push("enforced_by:");

    for (const p of enforcedBy) {
      lines.push(`  - ${JSON.stringify(normalizeRepoPath(p))}`);
    }
  }

  lines.push(
    `supersedes: ${fm.supersedes ? JSON.stringify(fm.supersedes) : "null"}`,
  );

  lines.push(
    `superseded_by: ${fm.superseded_by ? JSON.stringify(fm.superseded_by) : "null"}`,
  );

  lines.push("---");

  return lines.join("\n");
}

export function serializeAdrDocument(frontmatter, body) {
  return `${serializeFrontmatter(frontmatter)}\n\n${normalizeLf(body).trim()}\n`;
}

export function loadAllAdrs(rootDir) {
  const adrDir = path.join(rootDir, "docs", "adr");

  if (!fs.existsSync(adrDir)) {
    return [];
  }

  const entries = fs.readdirSync(adrDir, { withFileTypes: true });
  const adrs = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (entry.name === "README.md" || entry.name.startsWith(".")) {
      continue;
    }

    if (!entry.name.endsWith(".md")) {
      continue;
    }

    const filePath = path.join(adrDir, entry.name);
    const rawContent = fs.readFileSync(filePath, "utf8");
    const { frontmatter, body } = parseFrontmatterAndBody(rawContent);

    adrs.push({
      filename: entry.name,
      filePath,
      relPath: `docs/adr/${entry.name}`,
      frontmatter,
      body,
      rawContent,
      bodyHash: computeBodyHash(rawContent),
    });
  }

  adrs.sort((a, b) => a.filename.localeCompare(b.filename));

  return adrs;
}

export function readLockfile(rootDir) {
  const lockPath = path.join(rootDir, "docs", "adr", ".adr-lock.json");

  if (!fs.existsSync(lockPath)) {
    return null;
  }

  const raw = fs.readFileSync(lockPath, "utf8");

  return JSON.parse(raw);
}

export function writeLockfile(rootDir, records) {
  const adrDir = path.join(rootDir, "docs", "adr");

  fs.mkdirSync(adrDir, { recursive: true });

  const lockPath = path.join(adrDir, ".adr-lock.json");
  const sortedKeys = Object.keys(records).sort();
  const sortedRecords = {};

  for (const key of sortedKeys) {
    sortedRecords[key] = records[key];
  }

  const payload = {
    version: 1,
    records: sortedRecords,
  };

  fs.writeFileSync(lockPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return payload;
}

export function readGitHeadLockfile(rootDir) {
  try {
    const out = execFileSync("git", ["show", "HEAD:docs/adr/.adr-lock.json"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return JSON.parse(out);
  } catch {
    return null;
  }
}

export function formatMarkdownTable(headers, rows) {
  const widths = headers.map((header, colIdx) => {
    const maxRowLen = rows.reduce((max, row) => Math.max(max, String(row[colIdx] ?? "").length), 0);

    return Math.max(header.length, 3, maxRowLen);
  });

  const renderRow = (cells) =>
    `| ${cells.map((cell, idx) => String(cell ?? "").padEnd(widths[idx], " ")).join(" | ")} |`;

  const separator = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;

  return [renderRow(headers), separator, ...rows.map(renderRow)].join("\n");
}

export function generateAdrReadmeContent(adrs) {
  const activeAdrs = adrs.filter((a) => isActiveStatus(a.frontmatter.status));
  const historicalAdrs = adrs.filter((a) => !isActiveStatus(a.frontmatter.status));

  const headers = ["ID", "Title", "Status", "Date", "Area"];
  const toRow = (adr) => [
    `[${adr.frontmatter.id}](./${adr.filename})`,
    adr.frontmatter.title,
    adr.frontmatter.status,
    adr.frontmatter.date,
    adr.frontmatter.area,
  ];

  const lines = [
    "# Architectural Decision Records (ADRs)",
    "",
    "This directory contains the Architecture Decision Log (ADL) for Z-Trader, structured according to the **MADR 4.0 (Markdown Architectural Decision Records)** standard enhanced with **AI-Agent bidirectional traceability** (`applies_to` and `enforced_by` frontmatter).",
    "",
    "## Governance, Lifecycle & Immutability",
    "",
    "- **Decision Makers**: Product Owner & specialized AI agents (e.g. Architect Agent, Main Agent, Tester Agent).",
    "- **MADR 4.0 Immutable Log**: Accepted ADRs are immutable historical records. When an architectural decision is replaced or retired, the original file is never deleted or overwritten; its frontmatter `status` is updated to `superseded by ADR-XXXX` or `deprecated`, and a new ADR is created.",
    "- **AI Agent Filtering & Enforcement**: Coding agents and automated path gates enforce only active decisions (`status: \"accepted\"`). Use `pnpm adr:list --module <name>` to query active decisions for a domain module, and `pnpm adr:check` to validate compliance.",
    "",
    "## Active Decisions Index",
    "",
  ];

  if (activeAdrs.length > 0) {
    lines.push(formatMarkdownTable(headers, activeAdrs.map(toRow)));
  } else {
    lines.push("_No active decisions._");
  }

  if (historicalAdrs.length > 0) {
    lines.push("");
    lines.push("## Historical Decisions Index");
    lines.push("");
    lines.push(formatMarkdownTable(headers, historicalAdrs.map(toRow)));
  }

  return `${lines.join("\n")}\n`;
}

export function pathMatchesTarget(entryPath, targetPath) {
  const normEntry = normalizeRepoPath(entryPath);
  const normTarget = normalizeRepoPath(targetPath);

  if (!normEntry || !normTarget) {
    return false;
  }

  return (
    normEntry === normTarget ||
    normEntry.startsWith(`${normTarget}/`) ||
    normTarget.startsWith(`${normEntry}/`)
  );
}

export function renderModuleGoverningAdrsSection(moduleName, adrs) {
  const targetModulePath = `src/modules/${moduleName}`;
  const governing = adrs.filter(
    (adr) =>
      adr.frontmatter.status === "accepted" &&
      Array.isArray(adr.frontmatter.applies_to) &&
      adr.frontmatter.applies_to.some((p) => pathMatchesTarget(p, targetModulePath)),
  );

  const lines = ["## Governing ADRs", ""];

  if (governing.length === 0) {
    lines.push("- None.");
  } else {
    for (const adr of governing) {
      lines.push(
        `- [${adr.frontmatter.id}: ${adr.frontmatter.title}](../../../docs/adr/${adr.filename}) — ${adr.frontmatter.area}`,
      );
    }
  }

  return lines.join("\n");
}

export function updateModuleReadmeContent(existingContent, moduleName, adrs) {
  const normalized = normalizeLf(existingContent);
  const sectionText = renderModuleGoverningAdrsSection(moduleName, adrs);
  const headingRegex = /^## Governing ADRs\s*$/m;
  const match = headingRegex.exec(normalized);

  if (!match) {
    return `${normalized.trimEnd()}\n\n${sectionText}\n`;
  }

  const startIdx = match.index;
  const afterHeadingIdx = startIdx + match[0].length;
  const rest = normalized.slice(afterHeadingIdx);
  const nextH2Match = /^##\s+/m.exec(rest);

  if (!nextH2Match) {
    const prefix = normalized.slice(0, startIdx).trimEnd();

    return `${prefix}\n\n${sectionText}\n`;
  }

  const endIdx = afterHeadingIdx + nextH2Match.index;
  const prefix = normalized.slice(0, startIdx).trimEnd();
  const suffix = normalized.slice(endIdx).trimStart();

  return `${prefix}\n\n${sectionText}\n\n${suffix}`;
}

export function syncAdrs(rootDir) {
  const adrs = loadAllAdrs(rootDir);
  const adrDir = path.join(rootDir, "docs", "adr");

  fs.mkdirSync(adrDir, { recursive: true });

  // 1. Update lockfile without overwriting existing locked hashes
  const existingLock = readLockfile(rootDir);
  const headLock = readGitHeadLockfile(rootDir);
  const records = { ...(existingLock?.records ?? {}) };

  const currentIds = new Set();

  for (const adr of adrs) {
    const id = adr.frontmatter.id;

    if (id) {
      currentIds.add(id);

      if (!Object.prototype.hasOwnProperty.call(records, id)) {
        records[id] = adr.bodyHash;
      }
    }
  }

  // Remove orphaned non-HEAD records
  for (const recordedId of Object.keys(records)) {
    if (!currentIds.has(recordedId) && !headLock?.records?.[recordedId]) {
      delete records[recordedId];
    }
  }

  writeLockfile(rootDir, records);

  // 2. Write docs/adr/README.md
  const readmePath = path.join(adrDir, "README.md");
  const expectedReadme = generateAdrReadmeContent(adrs);

  fs.writeFileSync(readmePath, expectedReadme, "utf8");

  // 3. Synchronize src/modules/*/README.md
  const modulesDir = path.join(rootDir, "src", "modules");

  if (fs.existsSync(modulesDir)) {
    const entries = fs.readdirSync(modulesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const modReadmePath = path.join(modulesDir, entry.name, "README.md");

      if (!fs.existsSync(modReadmePath)) {
        continue;
      }

      const currentModReadme = fs.readFileSync(modReadmePath, "utf8");
      const updatedModReadme = updateModuleReadmeContent(currentModReadme, entry.name, adrs);

      if (normalizeLf(currentModReadme) !== updatedModReadme) {
        fs.writeFileSync(modReadmePath, updatedModReadme, "utf8");
      }
    }
  }

  return { adrsCount: adrs.length };
}

function validateCanonicalH2Sections(body, relPath, errors) {
  const lines = normalizeLf(body).split("\n");
  const h2Found = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();

    if (line.startsWith("## ")) {
      h2Found.push({ heading: line, lineIndex: i });
    }
  }

  const foundHeadings = h2Found.map((h) => h.heading);

  if (foundHeadings.length !== CANONICAL_H2_SECTIONS.length) {
    errors.push(
      `${relPath}: Expected exactly ${CANONICAL_H2_SECTIONS.length} H2 sections (${CANONICAL_H2_SECTIONS.join(", ")}), but found ${foundHeadings.length} (${foundHeadings.join(", ") || "none"}).`,
    );

    return;
  }

  for (let idx = 0; idx < CANONICAL_H2_SECTIONS.length; idx += 1) {
    if (foundHeadings[idx] !== CANONICAL_H2_SECTIONS[idx]) {
      errors.push(
        `${relPath}: H2 section order mismatch at position ${idx + 1}. Expected "${CANONICAL_H2_SECTIONS[idx]}", found "${foundHeadings[idx]}".`,
      );

      return;
    }

    const startLine = h2Found[idx].lineIndex + 1;
    const endLine = idx + 1 < h2Found.length ? h2Found[idx + 1].lineIndex : lines.length;
    const sectionContent = lines
      .slice(startLine, endLine)
      .join("\n")
      .trim();

    if (!sectionContent) {
      errors.push(`${relPath}: Section "${CANONICAL_H2_SECTIONS[idx]}" must not be empty.`);
    }
  }
}

function isSafeRepoRelativePath(rootDir, candidatePath) {
  const norm = normalizeRepoPath(candidatePath);

  if (!norm || path.isAbsolute(norm) || norm.startsWith("..") || norm.includes("/../")) {
    return false;
  }

  const resolved = path.resolve(rootDir, norm);
  const normalizedRoot = path.resolve(rootDir);

  return resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${path.sep}`);
}

export function checkAdrs(rootDir) {
  const errors = [];
  const adrDir = path.join(rootDir, "docs", "adr");

  if (!fs.existsSync(adrDir)) {
    errors.push("docs/adr directory does not exist.");

    return { ok: false, errors };
  }

  const entries = fs.readdirSync(adrDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      errors.push(
        `docs/adr/${entry.name}: Subdirectories inside docs/adr/ are forbidden (flat immutable log required).`,
      );

      continue;
    }

    if (entry.name === "README.md" || entry.name === ".adr-lock.json") {
      continue;
    }

    if (!ADR_FILENAME_REGEX.test(entry.name)) {
      errors.push(
        `docs/adr/${entry.name}: Invalid ADR filename. Expected format "XXXX-<kebab-slug>.md".`,
      );
    }
  }

  let adrs = [];

  try {
    adrs = loadAllAdrs(rootDir);
  } catch (err) {
    errors.push(`Failed to parse ADR files: ${err.message}`);

    return { ok: false, errors };
  }

  const adrById = new Map();

  for (const adr of adrs) {
    const { filename, relPath, frontmatter: fm, body } = adr;
    const fileMatch = filename.match(ADR_FILENAME_REGEX);
    const expectedId = fileMatch ? `ADR-${fileMatch[1]}` : null;

    if (!fm.id || typeof fm.id !== "string" || !ADR_ID_REGEX.test(fm.id)) {
      errors.push(`${relPath}: Frontmatter "id" must match "ADR-XXXX".`);
    } else if (expectedId && fm.id !== expectedId) {
      errors.push(
        `${relPath}: Frontmatter id "${fm.id}" does not match filename prefix "${expectedId}".`,
      );
    } else if (adrById.has(fm.id)) {
      errors.push(`${relPath}: Duplicate ADR id "${fm.id}".`);
    } else {
      adrById.set(fm.id, adr);
    }

    if (!fm.title || typeof fm.title !== "string" || !fm.title.trim()) {
      errors.push(`${relPath}: Frontmatter "title" must be a non-empty string.`);
    }

    if (!fm.status || typeof fm.status !== "string" || !isValidStatus(fm.status)) {
      errors.push(
        `${relPath}: Invalid frontmatter status "${fm.status}". Allowed: proposed, accepted, rejected, deprecated, or "superseded by ADR-XXXX".`,
      );
    }

    if (!fm.date || typeof fm.date !== "string" || !ISO_DATE_REGEX.test(fm.date)) {
      errors.push(`${relPath}: Frontmatter "date" must match YYYY-MM-DD.`);
    }

    if (!Array.isArray(fm["decision-makers"]) || fm["decision-makers"].length === 0) {
      errors.push(`${relPath}: Frontmatter "decision-makers" must be a non-empty list.`);
    }

    if (!fm.area || typeof fm.area !== "string" || !fm.area.trim()) {
      errors.push(`${relPath}: Frontmatter "area" must be a non-empty string.`);
    }

    if (!Array.isArray(fm.applies_to)) {
      errors.push(`${relPath}: Frontmatter "applies_to" must be an array.`);
    } else if (isActiveStatus(fm.status) && fm.applies_to.length === 0) {
      errors.push(`${relPath}: Active ADR (${fm.status}) must have a non-empty "applies_to" list.`);
    }

    if (!Array.isArray(fm.enforced_by)) {
      errors.push(`${relPath}: Frontmatter "enforced_by" must be an array.`);
    } else if (fm.status === "accepted" && fm.enforced_by.length === 0) {
      errors.push(`${relPath}: Accepted ADR must declare at least one "enforced_by" gate.`);
    }

    if (!Object.prototype.hasOwnProperty.call(fm, "supersedes")) {
      errors.push(`${relPath}: Missing required frontmatter field "supersedes".`);
    }

    if (!Object.prototype.hasOwnProperty.call(fm, "superseded_by")) {
      errors.push(`${relPath}: Missing required frontmatter field "superseded_by".`);
    }

    // H1 check
    const firstLine = normalizeLf(body).split("\n")[0]?.trim() ?? "";
    const expectedH1 = `# ${fm.id}: ${fm.title}`;

    if (firstLine !== expectedH1) {
      errors.push(`${relPath}: Expected H1 heading "${expectedH1}", found "${firstLine}".`);
    }

    // H2 canonical order & non-empty check
    validateCanonicalH2Sections(body, relPath, errors);

    // Active-only filesystem path verification
    if (fm.status === "accepted") {
      for (const field of ["applies_to", "enforced_by"]) {
        const list = Array.isArray(fm[field]) ? fm[field] : [];

        for (const repoPath of list) {
          if (!isSafeRepoRelativePath(rootDir, repoPath)) {
            errors.push(`${relPath}: Invalid or unsafe path "${repoPath}" in "${field}".`);
            continue;
          }

          const resolved = path.join(rootDir, normalizeRepoPath(repoPath));

          if (!fs.existsSync(resolved)) {
            errors.push(
              `${relPath}: Path "${repoPath}" in "${field}" does not exist on disk (active ADR path enforcement).`,
            );
          }
        }
      }
    }
  }

  // Bidirectional supersedes / superseded_by integrity
  for (const adr of adrs) {
    const { relPath, frontmatter: fm } = adr;
    const statusMatch =
      typeof fm.status === "string" ? fm.status.match(SUPERSEDED_STATUS_REGEX) : null;

    if (statusMatch) {
      const expectedSuperseder = statusMatch[1];

      if (fm.superseded_by !== expectedSuperseder) {
        errors.push(
          `${relPath}: Status is "${fm.status}", so "superseded_by" must be "${expectedSuperseder}" (found "${fm.superseded_by}").`,
        );
      }
    } else if (fm.superseded_by !== null && fm.superseded_by !== undefined) {
      errors.push(
        `${relPath}: "superseded_by" is "${fm.superseded_by}", but status is "${fm.status}" instead of "superseded by ${fm.superseded_by}".`,
      );
    }

    if (fm.superseded_by) {
      const newer = adrById.get(fm.superseded_by);

      if (!newer) {
        errors.push(
          `${relPath}: References non-existent superseding ADR "${fm.superseded_by}" in "superseded_by".`,
        );
      } else if (newer.frontmatter.supersedes !== fm.id) {
        errors.push(
          `${relPath}: Superseded by "${fm.superseded_by}", but ${newer.relPath} does not set "supersedes: ${fm.id}".`,
        );
      }
    }

    if (fm.supersedes) {
      const older = adrById.get(fm.supersedes);

      if (!older) {
        errors.push(
          `${relPath}: References non-existent superseded ADR "${fm.supersedes}" in "supersedes".`,
        );
      } else {
        if (older.frontmatter.superseded_by !== fm.id) {
          errors.push(
            `${relPath}: Supersedes "${fm.supersedes}", but ${older.relPath} does not set "superseded_by: ${fm.id}".`,
          );
        }

        if (older.frontmatter.status !== `superseded by ${fm.id}`) {
          errors.push(
            `${relPath}: Supersedes "${fm.supersedes}", but ${older.relPath} status is "${older.frontmatter.status}" instead of "superseded by ${fm.id}".`,
          );
        }
      }
    }
  }

  // Cryptographic Body Lock & Git HEAD Anchoring
  let lock = null;

  try {
    lock = readLockfile(rootDir);
  } catch (err) {
    errors.push(`docs/adr/.adr-lock.json: Invalid JSON (${err.message}).`);
  }

  if (!lock || typeof lock !== "object" || lock.version !== 1 || typeof lock.records !== "object") {
    errors.push(
      "docs/adr/.adr-lock.json: Missing or invalid lockfile (expected version: 1 and records map).",
    );
  } else {
    for (const adr of adrs) {
      const id = adr.frontmatter.id;
      const recordedHash = lock.records[id];

      if (!recordedHash) {
        errors.push(`docs/adr/.adr-lock.json: Missing body hash entry for ${id}.`);
      } else if (recordedHash !== adr.bodyHash) {
        errors.push(
          `${adr.relPath}: Tampering violation! Markdown body hash (${adr.bodyHash.slice(0, 12)}...) does not match locked hash in docs/adr/.adr-lock.json (${recordedHash.slice(0, 12)}...). Accepted ADR bodies are immutable; use "pnpm adr:supersede" instead.`,
        );
      }
    }

    for (const recordedId of Object.keys(lock.records)) {
      if (!adrById.has(recordedId)) {
        errors.push(
          `docs/adr/.adr-lock.json: Lockfile contains orphaned or deleted ADR "${recordedId}".`,
        );
      }
    }

    const headLock = readGitHeadLockfile(rootDir);

    if (headLock && headLock.records && typeof headLock.records === "object") {
      for (const [id, headHash] of Object.entries(headLock.records)) {
        const currentRecordedHash = lock.records[id];

        if (!currentRecordedHash) {
          errors.push(
            `docs/adr/.adr-lock.json: Tampering violation! Lock entry for ${id} present in git HEAD was removed.`,
          );
        } else if (currentRecordedHash !== headHash) {
          errors.push(
            `docs/adr/.adr-lock.json: Tampering violation! Lock hash for ${id} was modified relative to git HEAD.`,
          );
        }

        const currentAdr = adrById.get(id);

        if (!currentAdr) {
          errors.push(
            `docs/adr/: Tampering violation! Immutable ADR ${id} present in git HEAD lockfile was deleted.`,
          );
        } else if (currentAdr.bodyHash !== headHash) {
          errors.push(
            `${currentAdr.relPath}: Tampering violation! Body of ${id} differs from git HEAD lock hash.`,
          );
        }
      }
    }
  }

  // README Synchronization Drift Checks
  const readmePath = path.join(adrDir, "README.md");

  if (!fs.existsSync(readmePath)) {
    errors.push("docs/adr/README.md does not exist. Run `pnpm adr:sync`.");
  } else {
    const actualReadme = normalizeLf(fs.readFileSync(readmePath, "utf8"));
    const expectedReadme = normalizeLf(generateAdrReadmeContent(adrs));

    if (actualReadme !== expectedReadme) {
      errors.push("docs/adr/README.md is out of sync with ADR metadata. Run `pnpm adr:sync`.");
    }
  }

  const modulesDir = path.join(rootDir, "src", "modules");

  if (fs.existsSync(modulesDir)) {
    const entries = fs.readdirSync(modulesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const modReadmePath = path.join(modulesDir, entry.name, "README.md");

      if (!fs.existsSync(modReadmePath)) {
        continue;
      }

      const actualModReadme = normalizeLf(fs.readFileSync(modReadmePath, "utf8"));
      const expectedModReadme = normalizeLf(
        updateModuleReadmeContent(actualModReadme, entry.name, adrs),
      );

      if (actualModReadme !== expectedModReadme) {
        errors.push(
          `src/modules/${entry.name}/README.md "## Governing ADRs" section is out of sync. Run \`pnpm adr:sync\`.`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function buildDefaultAdrBody({
  id,
  title,
  context,
  drivers,
  outcome,
  confirmation,
  consequences,
  alternatives,
  enforcedBy,
}) {
  const defaultEnforcement =
    enforcedBy && enforcedBy.length > 0
      ? enforcedBy.map((p) => `- **Verification Gate (\`${p}\`)**: Enforces compliance with ${id}.`).join("\n")
      : "- **Verification Gate**: Enforces compliance with this decision.";

  return [
    `# ${id}: ${title}`,
    "",
    "## Context and Problem Statement",
    "",
    context ||
      `Define the architectural context and problem statement for ${title}.`,
    "",
    "## Decision Drivers",
    "",
    drivers ||
      "- **Architectural Consistency**: Maintain strict modular boundaries and deterministic verification.\n- **Maintainability**: Keep module contracts explicit and isolated.",
    "",
    "## Decision Outcome",
    "",
    outcome ||
      `Chosen option: **${title}**, providing a deterministic, testable architecture aligned with project constraints.`,
    "",
    "## Confirmation and Enforcement",
    "",
    confirmation || defaultEnforcement,
    "",
    "## Consequences",
    "",
    consequences ||
      "### Positive\n\n- Preserves modular encapsulation and automated verification.\n\n### Negative\n\n- Requires maintaining explicit contract and verification gates.",
    "",
    "## Rejected Alternatives",
    "",
    alternatives ||
      "- **Ad-Hoc Unchecked Implementation**: Lacks deterministic boundary enforcement and causes architectural drift.",
  ].join("\n");
}

function allocateNextAdrNumber(adrs) {
  let maxNum = 0;

  for (const adr of adrs) {
    const m = adr.filename.match(ADR_FILENAME_REGEX);

    if (m) {
      const n = Number.parseInt(m[1], 10);

      if (n > maxNum) {
        maxNum = n;
      }
    }
  }

  return String(maxNum + 1).padStart(4, "0");
}

export function createNewAdr(rootDir, options) {
  const adrs = loadAllAdrs(rootDir);
  const nextNum = allocateNextAdrNumber(adrs);
  const id = `ADR-${nextNum}`;
  const title = String(options.title || "").trim();

  if (!title) {
    throw new Error("Missing required ADR title (`--title \"<Title>\"`).");
  }

  const slug = options.slug ? slugifyTitle(options.slug) : slugifyTitle(title);

  if (!slug) {
    throw new Error(`Unable to derive valid filename slug from title "${title}".`);
  }

  const filename = `${nextNum}-${slug}.md`;
  const status = options.status || "accepted";
  const date = options.date || new Date().toISOString().slice(0, 10);
  const decisionMakers =
    options.decisionMakers && options.decisionMakers.length > 0
      ? options.decisionMakers
      : ["Product Owner", "Architect Agent"];
  const area = options.area || "Architecture & Layout";
  const appliesTo =
    options.appliesTo && options.appliesTo.length > 0
      ? options.appliesTo.map(normalizeRepoPath)
      : ["docs/adr"];
  const enforcedBy =
    options.enforcedBy && options.enforcedBy.length > 0
      ? options.enforcedBy.map(normalizeRepoPath)
      : [appliesTo[0]];

  const frontmatter = {
    id,
    title,
    status,
    date,
    "decision-makers": decisionMakers,
    area,
    applies_to: appliesTo,
    enforced_by: enforcedBy,
    supersedes: options.supersedes || null,
    superseded_by: null,
  };

  const body = buildDefaultAdrBody({
    id,
    title,
    context: options.context,
    drivers: options.drivers,
    outcome: options.outcome,
    confirmation: options.confirmation,
    consequences: options.consequences,
    alternatives: options.alternatives,
    enforcedBy,
  });

  const adrDir = path.join(rootDir, "docs", "adr");

  fs.mkdirSync(adrDir, { recursive: true });

  const filePath = path.join(adrDir, filename);
  const docContent = serializeAdrDocument(frontmatter, body);

  fs.writeFileSync(filePath, docContent, "utf8");

  const existingLock = readLockfile(rootDir);
  const records = { ...(existingLock?.records ?? {}) };

  records[id] = computeBodyHash(docContent);
  writeLockfile(rootDir, records);
  syncAdrs(rootDir);

  return { id, filename, filePath, frontmatter };
}

export function supersedeAdr(rootDir, targetRawId, options) {
  const targetId = normalizeAdrId(targetRawId);
  const adrs = loadAllAdrs(rootDir);
  const targetAdr = adrs.find((a) => a.frontmatter.id === targetId);

  if (!targetAdr) {
    throw new Error(`Target ADR "${targetId}" not found in docs/adr/.`);
  }

  if (SUPERSEDED_STATUS_REGEX.test(targetAdr.frontmatter.status)) {
    throw new Error(
      `ADR "${targetId}" is already ${targetAdr.frontmatter.status}. Supersede the active replacement instead.`,
    );
  }

  const created = createNewAdr(rootDir, {
    ...options,
    area: options.area || targetAdr.frontmatter.area,
    decisionMakers:
      options.decisionMakers && options.decisionMakers.length > 0
        ? options.decisionMakers
        : targetAdr.frontmatter["decision-makers"],
    appliesTo:
      options.appliesTo && options.appliesTo.length > 0
        ? options.appliesTo
        : targetAdr.frontmatter.applies_to,
    enforcedBy:
      options.enforcedBy && options.enforcedBy.length > 0
        ? options.enforcedBy
        : targetAdr.frontmatter.enforced_by,
    supersedes: targetId,
  });

  const updatedOldFrontmatter = {
    ...targetAdr.frontmatter,
    status: `superseded by ${created.id}`,
    superseded_by: created.id,
  };

  // Preserve original body verbatim so its SHA-256 hash in .adr-lock.json never changes
  const updatedOldDoc = serializeAdrDocument(updatedOldFrontmatter, targetAdr.body);

  fs.writeFileSync(targetAdr.filePath, updatedOldDoc, "utf8");
  syncAdrs(rootDir);

  return { supersededId: targetId, newAdr: created };
}

export function deprecateAdr(rootDir, targetRawId) {
  const targetId = normalizeAdrId(targetRawId);
  const adrs = loadAllAdrs(rootDir);
  const targetAdr = adrs.find((a) => a.frontmatter.id === targetId);

  if (!targetAdr) {
    throw new Error(`Target ADR "${targetId}" not found in docs/adr/.`);
  }

  const updatedFrontmatter = {
    ...targetAdr.frontmatter,
    status: "deprecated",
  };

  const updatedDoc = serializeAdrDocument(updatedFrontmatter, targetAdr.body);

  fs.writeFileSync(targetAdr.filePath, updatedDoc, "utf8");
  syncAdrs(rootDir);

  return { deprecatedId: targetId };
}

function rewritePathEntry(entry, oldPath, newPath) {
  const normEntry = normalizeRepoPath(entry);

  if (normEntry === oldPath) {
    return newPath;
  }

  if (normEntry.startsWith(`${oldPath}/`)) {
    return `${newPath}${normEntry.slice(oldPath.length)}`;
  }

  return normEntry;
}

export function retargetAdrPaths(rootDir, rawOldPath, rawNewPath) {
  const oldPath = normalizeRepoPath(rawOldPath);
  const newPath = normalizeRepoPath(rawNewPath);

  if (!oldPath || !newPath) {
    throw new Error("Usage: adr-cli.mjs retarget <old-path> <new-path>");
  }

  const adrs = loadAllAdrs(rootDir);
  const headLock = readGitHeadLockfile(rootDir);
  const existingLock = readLockfile(rootDir);
  const records = { ...(existingLock?.records ?? {}) };
  const updatedIds = [];

  for (const adr of adrs) {
    if (!isActiveStatus(adr.frontmatter.status)) {
      continue;
    }

    const oldApplies = Array.isArray(adr.frontmatter.applies_to) ? adr.frontmatter.applies_to : [];
    const oldEnforced = Array.isArray(adr.frontmatter.enforced_by)
      ? adr.frontmatter.enforced_by
      : [];

    const newApplies = Array.from(
      new Set(oldApplies.map((p) => rewritePathEntry(p, oldPath, newPath))),
    );
    const newEnforced = Array.from(
      new Set(oldEnforced.map((p) => rewritePathEntry(p, oldPath, newPath))),
    );

    const fmChanged =
      JSON.stringify(newApplies) !== JSON.stringify(oldApplies) ||
      JSON.stringify(newEnforced) !== JSON.stringify(oldEnforced);

    // Only rewrite body if not anchored in git HEAD lockfile
    const isAnchoredInHead = Boolean(headLock?.records?.[adr.frontmatter.id]);
    const updatedBody = isAnchoredInHead ? adr.body : adr.body.split(oldPath).join(newPath);
    const bodyChanged = updatedBody !== adr.body;

    if (fmChanged || bodyChanged) {
      const updatedFrontmatter = {
        ...adr.frontmatter,
        applies_to: newApplies,
        enforced_by: newEnforced,
      };
      const updatedDoc = serializeAdrDocument(updatedFrontmatter, updatedBody);

      fs.writeFileSync(adr.filePath, updatedDoc, "utf8");

      if (bodyChanged) {
        records[adr.frontmatter.id] = computeBodyHash(updatedDoc);
      }

      updatedIds.push(adr.frontmatter.id);
    }
  }

  writeLockfile(rootDir, records);
  syncAdrs(rootDir);

  return { updatedIds };
}

function matchesRemovedPath(entry, removedPath) {
  const normEntry = normalizeRepoPath(entry);

  return normEntry === removedPath || normEntry.startsWith(`${removedPath}/`);
}

export function removeAdrPath(rootDir, rawRemovedPath) {
  const removedPath = normalizeRepoPath(rawRemovedPath);

  if (!removedPath) {
    throw new Error("Usage: adr-cli.mjs remove-path <path>");
  }

  const adrs = loadAllAdrs(rootDir);
  const prunedIds = [];
  const autoDeprecatedIds = [];

  for (const adr of adrs) {
    if (!isActiveStatus(adr.frontmatter.status)) {
      continue;
    }

    const oldApplies = Array.isArray(adr.frontmatter.applies_to) ? adr.frontmatter.applies_to : [];
    const oldEnforced = Array.isArray(adr.frontmatter.enforced_by)
      ? adr.frontmatter.enforced_by
      : [];

    const newApplies = oldApplies.filter((p) => !matchesRemovedPath(p, removedPath));
    const newEnforced = oldEnforced.filter((p) => !matchesRemovedPath(p, removedPath));

    if (newApplies.length === oldApplies.length && newEnforced.length === oldEnforced.length) {
      continue;
    }

    let nextStatus = adr.frontmatter.status;

    if (oldApplies.length > 0 && newApplies.length === 0) {
      nextStatus = "deprecated";
      autoDeprecatedIds.push(adr.frontmatter.id);
    } else {
      prunedIds.push(adr.frontmatter.id);
    }

    const updatedFrontmatter = {
      ...adr.frontmatter,
      status: nextStatus,
      applies_to: newApplies,
      enforced_by: newEnforced,
    };

    const updatedDoc = serializeAdrDocument(updatedFrontmatter, adr.body);

    fs.writeFileSync(adr.filePath, updatedDoc, "utf8");
  }

  syncAdrs(rootDir);

  return { prunedIds, autoDeprecatedIds };
}

export function listAdrs(rootDir, options = {}) {
  const adrs = loadAllAdrs(rootDir);
  const includeAll = Boolean(options.all);
  const statusFilter = options.status ? String(options.status).trim().toLowerCase() : null;
  const moduleFilter = options.module ? String(options.module).trim() : null;
  const pathFilter = options.path ? normalizeRepoPath(options.path) : null;

  const targetPath = moduleFilter
    ? moduleFilter.startsWith("src/")
      ? normalizeRepoPath(moduleFilter)
      : `src/modules/${normalizeRepoPath(moduleFilter)}`
    : pathFilter;

  return adrs
    .filter((adr) => {
      const st = String(adr.frontmatter.status || "").toLowerCase();

      if (!includeAll) {
        if (statusFilter) {
          if (st !== statusFilter && !st.startsWith(statusFilter)) {
            return false;
          }
        } else if (st !== "accepted") {
          return false;
        }
      }

      if (targetPath) {
        const applies = Array.isArray(adr.frontmatter.applies_to) ? adr.frontmatter.applies_to : [];
        const enforced = Array.isArray(adr.frontmatter.enforced_by)
          ? adr.frontmatter.enforced_by
          : [];

        const matchesApplies = applies.some((p) => pathMatchesTarget(p, targetPath));
        const matchesEnforced = enforced.some((p) => pathMatchesTarget(p, targetPath));

        if (!matchesApplies && !matchesEnforced) {
          return false;
        }
      }

      return true;
    })
    .map((adr) => ({
      id: adr.frontmatter.id,
      title: adr.frontmatter.title,
      status: adr.frontmatter.status,
      date: adr.frontmatter.date,
      area: adr.frontmatter.area,
      decisionMakers: adr.frontmatter["decision-makers"],
      appliesTo: adr.frontmatter.applies_to,
      enforcedBy: adr.frontmatter.enforced_by,
      supersedes: adr.frontmatter.supersedes,
      supersededBy: adr.frontmatter.superseded_by,
      file: adr.relPath,
    }));
}

function parseCsvList(values) {
  const result = [];

  for (const val of values) {
    for (const part of String(val || "").split(",")) {
      const trimmed = part.trim();

      if (trimmed) {
        result.push(trimmed);
      }
    }
  }

  return result;
}

function parseCliArgs(argv) {
  const positionals = [];
  const flags = {
    appliesTo: [],
    enforcedBy: [],
    decisionMakers: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (FORBIDDEN_BYPASS_FLAGS.has(arg) || arg.startsWith("--force=") || arg.startsWith("--allow-edit=")) {
      throw new Error(
        `Forbidden bypass flag "${arg}". ADR body immutability and lock verification cannot be bypassed; use "pnpm adr:supersede" to replace an accepted decision.`,
      );
    }

    if (!arg.startsWith("--") && arg !== "-m") {
      positionals.push(arg);
      continue;
    }

    const eqIdx = arg.indexOf("=");
    const key = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;

    const nextVal = () => {
      if (eqIdx !== -1) {
        return arg.slice(eqIdx + 1);
      }

      i += 1;

      return argv[i] ?? "";
    };

    switch (key) {
      case "--root":

      case "--cwd":
        flags.root = nextVal();
        break;

      case "--module":

      case "-m":
        flags.module = nextVal();
        break;

      case "--path":
        flags.path = nextVal();
        break;

      case "--status":
        flags.status = nextVal();
        break;

      case "--all":
        flags.all = true;
        break;

      case "--json":
        flags.json = true;
        break;

      case "--title":
        flags.title = nextVal();
        break;

      case "--slug":
        flags.slug = nextVal();
        break;

      case "--area":
        flags.area = nextVal();
        break;

      case "--date":
        flags.date = nextVal();
        break;

      case "--applies-to":

      case "--applies_to":
        flags.appliesTo.push(nextVal());
        break;

      case "--enforced-by":

      case "--enforced_by":
        flags.enforcedBy.push(nextVal());
        break;

      case "--decision-makers":

      case "--decision_makers":
        flags.decisionMakers.push(nextVal());
        break;

      case "--target":

      case "--old":

      case "--supersedes":

      case "--id":
        flags.target = nextVal();
        break;

      case "--from":
        flags.from = nextVal();
        break;

      case "--to":
        flags.to = nextVal();
        break;

      case "--context":
        flags.context = nextVal();
        break;

      case "--drivers":
        flags.drivers = nextVal();
        break;

      case "--outcome":
        flags.outcome = nextVal();
        break;

      case "--confirmation":

      case "--enforcement":
        flags.confirmation = nextVal();
        break;

      case "--consequences":
        flags.consequences = nextVal();
        break;

      case "--alternatives":
        flags.alternatives = nextVal();
        break;

      default:
        throw new Error(`Unknown CLI flag: "${arg}"`);
    }
  }

  return { positionals, flags };
}

export function runCli(argv = process.argv.slice(2), defaultRoot = process.cwd()) {
  const { positionals, flags } = parseCliArgs(argv);
  const command = positionals[0];
  const rootDir = path.resolve(flags.root || process.env.ADR_ROOT || defaultRoot);

  switch (command) {
    case "list": {
      const results = listAdrs(rootDir, {
        module: flags.module,
        path: flags.path,
        status: flags.status,
        all: flags.all,
      });

      if (flags.json) {
        return { exitCode: 0, stdout: JSON.stringify(results, null, 2) };
      }

      if (results.length === 0) {
        return { exitCode: 0, stdout: "No matching ADRs found." };
      }

      const lines = results.map(
        (r) =>
          `${r.id} [${r.status}] — ${r.title} (${r.area})\n  File: ${r.file}\n  Applies to: ${(r.appliesTo || []).join(", ")}\n  Enforced by: ${(r.enforcedBy || []).join(", ")}`,
      );

      return { exitCode: 0, stdout: lines.join("\n\n") };
    }

    case "new": {
      const title = flags.title || positionals[1];
      const created = createNewAdr(rootDir, {
        title,
        slug: flags.slug,
        area: flags.area,
        status: flags.status,
        date: flags.date,
        appliesTo: parseCsvList(flags.appliesTo),
        enforcedBy: parseCsvList(flags.enforcedBy),
        decisionMakers: parseCsvList(flags.decisionMakers),
        context: flags.context,
        drivers: flags.drivers,
        outcome: flags.outcome,
        confirmation: flags.confirmation,
        consequences: flags.consequences,
        alternatives: flags.alternatives,
      });

      return {
        exitCode: 0,
        stdout: `Created ${created.id} at docs/adr/${created.filename}`,
      };
    }

    case "supersede": {
      const targetId = flags.target || positionals[1];
      const title = flags.title || positionals[2];

      if (!targetId) {
        throw new Error(
          "Usage: adr-cli.mjs supersede <ADR-XXXX> --title \"<New Title>\" [options]",
        );
      }

      const { supersededId, newAdr } = supersedeAdr(rootDir, targetId, {
        title,
        slug: flags.slug,
        area: flags.area,
        date: flags.date,
        appliesTo: parseCsvList(flags.appliesTo),
        enforcedBy: parseCsvList(flags.enforcedBy),
        decisionMakers: parseCsvList(flags.decisionMakers),
        context: flags.context,
        drivers: flags.drivers,
        outcome: flags.outcome,
        confirmation: flags.confirmation,
        consequences: flags.consequences,
        alternatives: flags.alternatives,
      });

      return {
        exitCode: 0,
        stdout: `Superseded ${supersededId} with ${newAdr.id} (docs/adr/${newAdr.filename})`,
      };
    }

    case "deprecate": {
      const targetId = flags.target || positionals[1];

      if (!targetId) {
        throw new Error("Usage: adr-cli.mjs deprecate <ADR-XXXX>");
      }

      const { deprecatedId } = deprecateAdr(rootDir, targetId);

      return {
        exitCode: 0,
        stdout: `Deprecated ${deprecatedId}`,
      };
    }

    case "retarget": {
      const oldPath = flags.from || positionals[1];
      const newPath = flags.to || positionals[2];
      const { updatedIds } = retargetAdrPaths(rootDir, oldPath, newPath);

      return {
        exitCode: 0,
        stdout: `Retargeted "${oldPath}" -> "${newPath}" across ${updatedIds.length} active ADR(s): ${updatedIds.join(", ") || "none"}`,
      };
    }

    case "remove-path": {
      const targetPath = flags.path || positionals[1];
      const { prunedIds, autoDeprecatedIds } = removeAdrPath(rootDir, targetPath);

      return {
        exitCode: 0,
        stdout: `Removed path "${targetPath}" (pruned: ${prunedIds.join(", ") || "none"}; auto-deprecated: ${autoDeprecatedIds.join(", ") || "none"})`,
      };
    }

    case "sync": {
      const { adrsCount } = syncAdrs(rootDir);

      return {
        exitCode: 0,
        stdout: `Synchronized ${adrsCount} ADR(s) across docs/adr/README.md, src/modules/*/README.md, and docs/adr/.adr-lock.json.`,
      };
    }

    case "check": {
      const result = checkAdrs(rootDir);

      if (!result.ok) {
        return {
          exitCode: 1,
          stderr: `ADR compliance check failed with ${result.errors.length} error(s):\n${result.errors.map((e) => `  - ${e}`).join("\n")}`,
        };
      }

      return {
        exitCode: 0,
        stdout: "ADR compliance check passed.",
      };
    }

    default:
      throw new Error(
        `Unknown or missing command "${command ?? ""}". Supported commands: list, new, supersede, deprecate, retarget, remove-path, sync, check.`,
      );
  }
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  try {
    const res = runCli(process.argv.slice(2));

    if (res.stdout) {
      console.log(res.stdout);
    }

    if (res.stderr) {
      console.error(res.stderr);
    }

    process.exit(res.exitCode);
  } catch (err) {
    console.error(`ADR CLI Error: ${err.message}`);
    process.exit(1);
  }
}
