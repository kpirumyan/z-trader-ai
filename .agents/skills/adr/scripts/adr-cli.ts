#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AdrFrontmatter {
  id: string;
  title: string;
  status: string;
  date: string;
  "decision-makers": string[];
  area: string;
  applies_to: string[];
  enforced_by: string[];
  supersedes: string | null;
  superseded_by: string | null;
}

type FrontmatterValue = string | string[] | null | undefined;

interface AdrRecord {
  fileName: string;
  filePath: string;
  frontmatter: Partial<AdrFrontmatter>;
  body: string;
  rawContent: string;
}

interface AdrContextOptions {
  rootDir?: string;
  adrDir?: string;
  modulesDir?: string;
}

interface AdrCommandOptions extends AdrContextOptions {
  baseRef?: string;
  silent?: boolean;
  noExit?: boolean;
}

interface AdrContext {
  root: string;
  adrDir: string;
  modulesDir: string;
}

interface ParsedCliArgs {
  _: string[];
  path?: string;
  base?: string;
  all?: boolean;
  json?: boolean;
  title?: string;
  area?: string;
  status?: string;
  "applies-to"?: string;
  "enforced-by"?: string;
  "decision-makers"?: string;
  [key: string]: string | boolean | string[] | undefined;
}

interface AdrListJsonItem {
  id: string | undefined;
  title: string | undefined;
  status: string | undefined;
  date: string | undefined;
  area: string | undefined;
  applies_to: string[] | undefined;
  enforced_by: string[] | undefined;
  file: string;
}

interface AdrCheckResult {
  valid: boolean;
  errors: string[];
}

interface AdrNewResult {
  id: string;
  fileName: string;
  filePath: string;
}

interface AdrSupersedeResult {
  nextId: string;
  filePath: string;
}

interface ResolvedBaseRef {
  label: string;
  sha: string;
}

// ---------------------------------------------------------------------------
// Root, Paths & Git Helpers
// ---------------------------------------------------------------------------
const CANONICAL_SECTIONS = [
  "Context and Problem Statement",
  "Decision Drivers",
  "Decision Outcome",
  "Confirmation and Enforcement",
  "Consequences",
  "Rejected Alternatives",
] as const;

const VALID_SIMPLE_STATUSES = new Set(["proposed", "accepted", "rejected", "deprecated"]);
const ZERO_SHA = "0000000000000000000000000000000000000000";
const DEFAULT_BASE_BRANCHES = ["origin/main", "main", "origin/master", "master"] as const;

function findProjectRoot(): string {
  let curr = process.cwd();

  while (curr !== path.dirname(curr)) {
    if (fs.existsSync(path.join(curr, "package.json"))) {
      return curr;
    }

    curr = path.dirname(curr);
  }

  return process.cwd();
}

const ROOT_DIR = findProjectRoot();
const ADR_DIR = path.join(ROOT_DIR, "docs", "adr");
const MODULES_DIR = path.join(ROOT_DIR, "src", "modules");

function getContext(opts: AdrContextOptions = {}): AdrContext {
  const root = opts.rootDir || process.env.ADR_ROOT_DIR || ROOT_DIR;
  const adrDir = opts.adrDir || (opts.rootDir ? path.join(opts.rootDir, "docs", "adr") : ADR_DIR);
  const modulesDir =
    opts.modulesDir || (opts.rootDir ? path.join(opts.rootDir, "src", "modules") : MODULES_DIR);

  return { root, adrDir, modulesDir };
}

function normalizeRepoRelPath(rawPath: string): string {
  return rawPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trim();
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, idx) => item === b[idx]);
}

function execGitRaw(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function readGitFilesBatch(
  root: string,
  sha: string,
  relPaths: string[],
): Map<string, string | null> {
  const result = new Map<string, string | null>();

  if (relPaths.length === 0) return result;

  const stdinPayload = `${relPaths.map((p) => `${sha}:${p}`).join("\n")}\n`;
  let out: Buffer;

  try {
    out = execFileSync("git", ["cat-file", "--batch"], {
      cwd: root,
      input: stdinPayload,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    for (const p of relPaths) result.set(p, null);

    return result;
  }

  let offset = 0;

  for (const relPath of relPaths) {
    const nlIdx = out.indexOf(0x0a, offset);

    if (nlIdx === -1) {
      result.set(relPath, null);
      break;
    }

    const header = out.subarray(offset, nlIdx).toString("utf8");

    offset = nlIdx + 1;

    if (header.endsWith(" missing")) {
      result.set(relPath, null);
      continue;
    }

    const parts = header.split(" ");
    const size = Number.parseInt(parts[2] ?? "", 10);

    if (Number.isNaN(size) || offset + size > out.length) {
      result.set(relPath, null);
      break;
    }

    result.set(relPath, out.subarray(offset, offset + size).toString("utf8"));
    offset += size;

    if (out[offset] === 0x0a) {
      offset += 1;
    }
  }

  return result;
}

function resolveGitCommit(ref: string, cwd: string): string | null {
  const output = execGitRaw(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);

  return output ? output.trim() || null : null;
}

// ---------------------------------------------------------------------------
// YAML Frontmatter Parser & Serializer (Zero External Dependencies)
// ---------------------------------------------------------------------------
function unquoteYamlScalar(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    try {
      const parsed: unknown = JSON.parse(raw);

      if (typeof parsed === "string") {
        return parsed;
      }
    } catch {
      return raw.slice(1, -1);
    }
  }

  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }

  return raw;
}

export function parseFrontmatter(raw: string): {
  frontmatter: Partial<AdrFrontmatter> | null;
  body: string;
} {
  const norm = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = norm.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    return { frontmatter: null, body: norm };
  }

  const fmText = match[1];
  const body = match[2];
  const lines = fmText.split("\n");
  const data: Record<string, FrontmatterValue> = {};

  let currentArray: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    if (/^\s*-\s+/.test(line) && currentArray) {
      const itemRaw = line.replace(/^\s*-\s+/, "").trim();

      currentArray.push(unquoteYamlScalar(itemRaw));
      continue;
    }

    const colonIdx = line.indexOf(":");

    if (colonIdx !== -1 && !line.startsWith(" ") && !line.startsWith("\t")) {
      const key = line.slice(0, colonIdx).trim();
      const rawVal = line.slice(colonIdx + 1).trim();

      if (rawVal === "" || rawVal === "[]") {
        currentArray = [];
        data[key] = currentArray;
      } else if (rawVal === "null") {
        data[key] = null;
        currentArray = null;
      } else {
        data[key] = unquoteYamlScalar(rawVal);
        currentArray = null;
      }
    }
  }

  return { frontmatter: data, body };
}

export function serializeFrontmatter(data: Partial<AdrFrontmatter>, body: string): string {
  const lines = ["---"];

  if (data.id !== undefined) lines.push(`id: ${JSON.stringify(data.id)}`);
  if (data.title !== undefined) lines.push(`title: ${JSON.stringify(data.title)}`);
  if (data.status !== undefined) lines.push(`status: ${JSON.stringify(data.status)}`);
  if (data.date !== undefined) lines.push(`date: ${JSON.stringify(data.date)}`);

  if (Array.isArray(data["decision-makers"])) {
    lines.push("decision-makers:");

    for (const dm of data["decision-makers"]) {
      lines.push(`  - ${JSON.stringify(dm)}`);
    }
  }

  if (data.area !== undefined) lines.push(`area: ${JSON.stringify(data.area)}`);

  if (Array.isArray(data.applies_to)) {
    lines.push("applies_to:");

    for (const p of data.applies_to) {
      lines.push(`  - ${JSON.stringify(p)}`);
    }
  }

  if (Array.isArray(data.enforced_by)) {
    lines.push("enforced_by:");

    for (const p of data.enforced_by) {
      lines.push(`  - ${JSON.stringify(p)}`);
    }
  }

  lines.push(`supersedes: ${data.supersedes ? JSON.stringify(data.supersedes) : "null"}`);
  lines.push(`superseded_by: ${data.superseded_by ? JSON.stringify(data.superseded_by) : "null"}`);
  lines.push("---");
  lines.push("");

  const trimmedBody = body.replace(/^\n+/, "");

  return `${lines.join("\n")}\n${trimmedBody}`;
}

// ---------------------------------------------------------------------------
// Load & Parse All ADRs
// ---------------------------------------------------------------------------
function loadAllAdrs(customAdrDir?: string): AdrRecord[] {
  const targetDir = customAdrDir || ADR_DIR;

  if (!fs.existsSync(targetDir)) return [];

  const entries = fs.readdirSync(targetDir);
  const adrs: AdrRecord[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md") || entry === "README.md") continue;

    const filePath = path.join(targetDir, entry);

    if (!fs.statSync(filePath).isFile()) continue;

    const content = fs.readFileSync(filePath, "utf8");
    const { frontmatter, body } = parseFrontmatter(content);

    if (!frontmatter || !frontmatter.id) continue;

    adrs.push({
      fileName: entry,
      filePath,
      frontmatter,
      body,
      rawContent: content,
    });
  }

  return adrs.sort((a, b) => (a.frontmatter.id ?? "").localeCompare(b.frontmatter.id ?? ""));
}

function getNextAdrNumber(adrs: AdrRecord[]): number {
  let maxNum = -1;

  for (const a of adrs) {
    const num = Number.parseInt((a.frontmatter.id ?? "").replace("ADR-", ""), 10);

    if (!Number.isNaN(num) && num > maxNum) {
      maxNum = num;
    }
  }

  return maxNum + 1;
}

function buildAdrSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeAdrId(idInput: string): string {
  return idInput.startsWith("ADR-") ? idInput : `ADR-${idInput.padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Generator: docs/adr/README.md & src/modules/*/README.md
// ---------------------------------------------------------------------------
function formatAdrIndexTable(rows: AdrRecord[]): string[] {
  const pad = (str: string, len: number): string => str.padEnd(len, " ");
  const idWidth = Math.max(
    3,
    "ID".length,
    ...rows.map((a) => `[${a.frontmatter.id ?? ""}](./${a.fileName})`.length),
  );
  const titleWidth = Math.max(
    3,
    "Title".length,
    ...rows.map((a) => (a.frontmatter.title || "").length),
  );
  const statusWidth = Math.max(
    3,
    "Status".length,
    ...rows.map((a) => (a.frontmatter.status || "").length),
  );
  const dateWidth = Math.max(
    3,
    "Date".length,
    ...rows.map((a) => (a.frontmatter.date || "").length),
  );
  const areaWidth = Math.max(
    3,
    "Area".length,
    ...rows.map((a) => (a.frontmatter.area || "").length),
  );

  const lines = [
    `| ${pad("ID", idWidth)} | ${pad("Title", titleWidth)} | ${pad("Status", statusWidth)} | ${pad("Date", dateWidth)} | ${pad("Area", areaWidth)} |`,
    `| ${"-".repeat(idWidth)} | ${"-".repeat(titleWidth)} | ${"-".repeat(statusWidth)} | ${"-".repeat(dateWidth)} | ${"-".repeat(areaWidth)} |`,
  ];

  for (const a of rows) {
    const idLink = `[${a.frontmatter.id ?? ""}](./${a.fileName})`;

    lines.push(
      `| ${pad(idLink, idWidth)} | ${pad(a.frontmatter.title ?? "", titleWidth)} | ${pad(a.frontmatter.status ?? "", statusWidth)} | ${pad(a.frontmatter.date ?? "", dateWidth)} | ${pad(a.frontmatter.area ?? "", areaWidth)} |`,
    );
  }

  return lines;
}

export function generateAdrReadme(adrs: AdrRecord[]): string {
  const activeAdrs = adrs.filter((a) =>
    ["accepted", "proposed"].includes(a.frontmatter.status ?? ""),
  );
  const historicalAdrs = adrs.filter(
    (a) => !["accepted", "proposed"].includes(a.frontmatter.status ?? ""),
  );

  const lines = [
    "# Architectural Decision Records (ADRs)",
    "",
    "This directory contains the Architecture Decision Log (ADL) for Z-Trader, structured according to the **MADR 4.0 (Markdown Architectural Decision Records)** standard enhanced with **AI-Agent bidirectional traceability** (`applies_to` and `enforced_by` frontmatter).",
    "",
    "## Governance, Lifecycle & Immutability",
    "",
    "- **Decision Makers**: Product Owner & specialized AI agents (e.g. Architect Agent, Main Agent, Tester Agent).",
    "- **MADR 4.0 Immutable Log**: Accepted ADRs are immutable historical records. When an architectural decision is replaced or retired, the original file is never deleted or overwritten; its frontmatter `status` is updated to `superseded by ADR-XXXX` or `deprecated`, and a new ADR is created.",
    '- **AI Agent Filtering & Enforcement**: Coding agents and automated path gates enforce only active decisions (`status: "accepted"`). Use `pnpm adr list --path <path>` to query active decisions for a path, and `pnpm adr:check` to validate compliance.',
    "",
    "## Active Decisions Index",
    "",
    ...formatAdrIndexTable(activeAdrs),
  ];

  if (historicalAdrs.length > 0) {
    lines.push("");
    lines.push("## Historical Decisions Index");
    lines.push("");
    lines.push(...formatAdrIndexTable(historicalAdrs));
  }

  lines.push("");

  return lines.join("\n");
}

export function matchesGovernancePath(appliesPath: string, targetPath: string): boolean {
  const normApplies = normalizeRepoRelPath(appliesPath);
  const normTarget = normalizeRepoRelPath(targetPath);

  if (!normApplies || !normTarget) {
    return false;
  }

  return (
    normApplies === normTarget ||
    normTarget.startsWith(`${normApplies}/`) ||
    normApplies.startsWith(`${normTarget}/`)
  );
}

export function getGoverningAdrsForPath(targetPath: string, adrs: AdrRecord[]): AdrRecord[] {
  return adrs
    .filter((a) => {
      if (a.frontmatter.status !== "accepted") return false;

      const applies = a.frontmatter.applies_to || [];

      return applies.some((p) => matchesGovernancePath(p, targetPath));
    })
    .sort((a, b) => (a.frontmatter.id ?? "").localeCompare(b.frontmatter.id ?? ""));
}

export function updateModuleReadmeContent(content: string, governingAdrs: AdrRecord[]): string {
  const headingIdx = content.indexOf("## Governing ADRs");
  const beforeSection = headingIdx !== -1 ? content.slice(0, headingIdx) : content.trim() + "\n\n";

  const lines = ["## Governing ADRs", ""];

  if (governingAdrs.length === 0) {
    lines.push("*No module-specific governing ADRs.*");
  } else {
    for (const a of governingAdrs) {
      lines.push(
        `- [${a.frontmatter.id ?? ""}: ${a.frontmatter.title ?? ""}](../../../docs/adr/${a.fileName}) \u2014 ${a.frontmatter.area ?? ""}`,
      );
    }
  }

  return `${beforeSection.trimEnd()}\n\n${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Command: list
// ---------------------------------------------------------------------------
export function cmdList(
  args: Partial<ParsedCliArgs>,
  opts: AdrCommandOptions = {},
): AdrListJsonItem[] | AdrRecord[] {
  const { adrDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);
  const pathArg = typeof args.path === "string" ? args.path : undefined;
  const showAll = Boolean(args.all);
  const asJson = Boolean(args.json);

  let filtered = adrs;

  if (!showAll) {
    filtered = filtered.filter((a) =>
      ["accepted", "proposed"].includes(a.frontmatter.status ?? ""),
    );
  }

  const targetFilter = pathArg ? normalizeRepoRelPath(pathArg) : undefined;

  if (targetFilter) {
    filtered = filtered.filter((a) => {
      const applies = a.frontmatter.applies_to || [];

      return applies.some((p) => matchesGovernancePath(p, targetFilter));
    });
  }

  if (asJson) {
    const out: AdrListJsonItem[] = filtered.map((a) => ({
      id: a.frontmatter.id,
      title: a.frontmatter.title,
      status: a.frontmatter.status,
      date: a.frontmatter.date,
      area: a.frontmatter.area,
      applies_to: a.frontmatter.applies_to,
      enforced_by: a.frontmatter.enforced_by,
      file: `docs/adr/${a.fileName}`,
    }));

    if (!opts.silent) {
      console.log(JSON.stringify(out, null, 2));
    }

    return out;
  }

  if (!opts.silent) {
    const scopeLabel = targetFilter ? ` for path "${targetFilter}"` : "";

    console.log(`\nFound ${filtered.length} ADR(s)${scopeLabel}:\n`);
    console.log(`${"ID".padEnd(10)} | ${"Status".padEnd(10)} | ${"Area".padEnd(25)} | Title`);
    console.log("-".repeat(80));

    for (const a of filtered) {
      const id = (a.frontmatter.id || "").padEnd(10);
      const status = (a.frontmatter.status || "").padEnd(10);
      const area = (a.frontmatter.area || "").padEnd(25);

      console.log(`${id} | ${status} | ${area} | ${a.frontmatter.title ?? ""}`);
    }

    console.log("");
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Command: sync
// ---------------------------------------------------------------------------
export function cmdSync(opts: AdrCommandOptions = {}): void {
  const { adrDir, modulesDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);

  const readmeContent = generateAdrReadme(adrs);
  const readmePath = path.join(adrDir, "README.md");

  fs.writeFileSync(readmePath, readmeContent, "utf8");

  if (!opts.silent) {
    console.log("Synchronized docs/adr/README.md");
  }

  if (fs.existsSync(modulesDir)) {
    const modules = fs.readdirSync(modulesDir);

    for (const mod of modules) {
      const modReadme = path.join(modulesDir, mod, "README.md");

      if (!fs.existsSync(modReadme)) continue;

      const current = fs.readFileSync(modReadme, "utf8");
      const governing = getGoverningAdrsForPath(`src/modules/${mod}`, adrs);
      const updated = updateModuleReadmeContent(current, governing);

      fs.writeFileSync(modReadme, updated, "utf8");

      if (!opts.silent) {
        console.log(`Synchronized src/modules/${mod}/README.md (${governing.length} ADRs)`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Validator Core: Schema, Links, Paths, Git-Anchored Immutability, Sync
// ---------------------------------------------------------------------------
function validateAdrStructure(
  adr: AdrRecord,
  root: string,
  adrMap: Map<string, AdrRecord>,
  errors: string[],
): void {
  const fm = adr.frontmatter;
  const prefix = `[${fm.id || adr.fileName}]`;

  if (!fm.id || !/^ADR-\d{4}$/.test(fm.id)) {
    errors.push(`${prefix} Invalid or missing id. Must match /^ADR-\\d{4}$/`);
  } else {
    const expectedNum = fm.id.slice(4);

    if (!adr.fileName.startsWith(`${expectedNum}-`)) {
      errors.push(
        `${prefix} Filename "${adr.fileName}" does not match id prefix "${expectedNum}-".`,
      );
    }
  }

  if (!fm.title || typeof fm.title !== "string" || !fm.title.trim()) {
    errors.push(`${prefix} Missing title`);
  }

  const isSuperseded = typeof fm.status === "string" && fm.status.startsWith("superseded by ADR-");

  if ((!fm.status || !VALID_SIMPLE_STATUSES.has(fm.status)) && !isSuperseded) {
    errors.push(
      `${prefix} Invalid status "${fm.status ?? ""}". Allowed: proposed, accepted, rejected, deprecated, or "superseded by ADR-XXXX"`,
    );
  }

  if (!fm.date || !/^\d{4}-\d{2}-\d{2}$/.test(fm.date)) {
    errors.push(`${prefix} Invalid date "${fm.date ?? ""}". Must be YYYY-MM-DD.`);
  }

  if (!Array.isArray(fm["decision-makers"]) || fm["decision-makers"].length === 0) {
    errors.push(`${prefix} Missing decision-makers list.`);
  }

  if (!fm.area || typeof fm.area !== "string") {
    errors.push(`${prefix} Missing area string.`);
  }

  if (!Array.isArray(fm.applies_to)) {
    errors.push(`${prefix} applies_to must be an array of paths.`);
  }

  if (!Array.isArray(fm.enforced_by)) {
    errors.push(`${prefix} enforced_by must be an array of paths.`);
  }

  // Canonical 6 H2 sections in exact order
  const h2Matches = [...adr.body.matchAll(/^##\s+([^\r\n]+)/gm)].map((m) => m[1].trim());
  let lastFoundIdx = -1;

  for (const expectedSec of CANONICAL_SECTIONS) {
    const idx = h2Matches.indexOf(expectedSec);

    if (idx === -1) {
      errors.push(`${prefix} Missing canonical section: "## ${expectedSec}"`);
    } else if (idx <= lastFoundIdx) {
      errors.push(`${prefix} Canonical section out of order: "## ${expectedSec}"`);
    } else {
      lastFoundIdx = idx;
    }
  }

  // Bidirectional superseding consistency
  if (fm.supersedes) {
    const target = adrMap.get(fm.supersedes);

    if (!target) {
      errors.push(`${prefix} supersedes "${fm.supersedes}" which does not exist.`);
    } else {
      if (target.frontmatter.superseded_by !== fm.id) {
        errors.push(
          `${prefix} supersedes "${fm.supersedes}", but ${fm.supersedes} does not link back with superseded_by: "${fm.id ?? ""}"`,
        );
      }

      if (target.frontmatter.status !== `superseded by ${fm.id ?? ""}`) {
        errors.push(
          `${prefix} supersedes "${fm.supersedes}", but ${fm.supersedes} status is "${target.frontmatter.status ?? ""}", expected "superseded by ${fm.id ?? ""}"`,
        );
      }
    }
  }

  if (fm.superseded_by) {
    const target = adrMap.get(fm.superseded_by);

    if (!target) {
      errors.push(`${prefix} superseded_by "${fm.superseded_by}" which does not exist.`);
    } else if (target.frontmatter.supersedes !== fm.id) {
      errors.push(
        `${prefix} superseded_by "${fm.superseded_by}", but ${fm.superseded_by} does not declare supersedes: "${fm.id ?? ""}"`,
      );
    }

    if (fm.status !== `superseded by ${fm.superseded_by}`) {
      errors.push(
        `${prefix} has superseded_by "${fm.superseded_by}", expected status "superseded by ${fm.superseded_by}", got "${fm.status ?? ""}".`,
      );
    }
  } else if (isSuperseded) {
    errors.push(`${prefix} has status "${fm.status ?? ""}" without matching superseded_by field.`);
  }

  // Active enforcement & path existence check (accepted only)
  if (fm.status === "accepted") {
    if (!Array.isArray(fm.enforced_by) || fm.enforced_by.length === 0) {
      errors.push(`${prefix} Active accepted ADR must declare at least one enforced_by path.`);
    }

    for (const p of fm.applies_to || []) {
      if (!fs.existsSync(path.join(root, p))) {
        errors.push(`${prefix} Active applies_to path does not exist on filesystem: "${p}"`);
      }
    }

    for (const p of fm.enforced_by || []) {
      if (!fs.existsSync(path.join(root, p))) {
        errors.push(`${prefix} Active enforced_by path does not exist on filesystem: "${p}"`);
      }
    }
  }
}

function resolveBaseRefs(
  root: string,
  explicitBaseRef: string | undefined,
  errors: string[],
): ResolvedBaseRef[] {
  const headSha = resolveGitCommit("HEAD", root);

  if (!headSha) {
    return [];
  }

  const rawExplicit = explicitBaseRef?.trim() || process.env.ADR_BASE_REF?.trim() || "";
  const hasExplicitRef = rawExplicit.length > 0 && rawExplicit !== ZERO_SHA;
  const refs: ResolvedBaseRef[] = [];
  const seenShas = new Set<string>();

  const addRef = (label: string, sha: string | null): void => {
    if (sha && !seenShas.has(sha)) {
      seenShas.add(sha);
      refs.push({ label, sha });
    }
  };

  if (hasExplicitRef) {
    const resolvedBase = resolveGitCommit(rawExplicit, root);

    if (!resolvedBase) {
      errors.push(`Git anchoring error: unable to resolve base ref "${rawExplicit}".`);
    } else {
      addRef(rawExplicit, resolvedBase);
    }
  }

  addRef("HEAD", headSha);

  if (!hasExplicitRef) {
    for (const branch of DEFAULT_BASE_BRANCHES) {
      if (!resolveGitCommit(branch, root)) {
        continue;
      }

      const mergeBaseOut = execGitRaw(["merge-base", "HEAD", branch], root);
      const mergeBaseSha = mergeBaseOut ? mergeBaseOut.trim() : null;

      addRef(`merge-base(${branch})`, mergeBaseSha);
      break;
    }
  }

  return refs;
}

function validateAgainstBaseRecord(
  relPath: string,
  baseRefLabel: string,
  baseFm: Partial<AdrFrontmatter>,
  baseBody: string,
  curAdr: AdrRecord,
  root: string,
  adrMap: Map<string, AdrRecord>,
  errors: string[],
): void {
  const prefix = `[${baseFm.id || relPath}]`;
  const curFm = curAdr.frontmatter;

  // 1. Body immutability
  if (normalizeBody(curAdr.body) !== normalizeBody(baseBody)) {
    errors.push(
      `${prefix} Body of committed ADR "${relPath}" was modified relative to ${baseRefLabel}. Direct edits are prohibited; use \`pnpm adr supersede ${baseFm.id ?? ""}\`.`,
    );
  }

  // 2. Strictly immutable metadata fields
  const immutableScalars = ["id", "title", "date", "area", "supersedes"] as const;

  for (const field of immutableScalars) {
    if ((curFm[field] ?? null) !== (baseFm[field] ?? null)) {
      errors.push(
        `${prefix} Immutable frontmatter field "${field}" was modified relative to ${baseRefLabel} in "${relPath}".`,
      );
    }
  }

  const baseMakers = Array.isArray(baseFm["decision-makers"]) ? baseFm["decision-makers"] : [];
  const curMakers = Array.isArray(curFm["decision-makers"]) ? curFm["decision-makers"] : [];

  if (!arraysEqual(curMakers, baseMakers)) {
    errors.push(
      `${prefix} Immutable frontmatter field "decision-makers" was modified relative to ${baseRefLabel} in "${relPath}".`,
    );
  }

  // 3. Allowed status & superseded_by transitions
  const baseStatus = baseFm.status ?? "";
  const curStatus = curFm.status ?? "";
  const baseSupersededBy = baseFm.superseded_by ?? null;
  const curSupersededBy = curFm.superseded_by ?? null;
  const statusOrLinkChanged = curStatus !== baseStatus || curSupersededBy !== baseSupersededBy;

  if (statusOrLinkChanged) {
    const baseWasActive = baseStatus === "accepted" || baseStatus === "proposed";
    const isValidSupersede =
      baseWasActive &&
      typeof curSupersededBy === "string" &&
      curStatus === `superseded by ${curSupersededBy}` &&
      adrMap.get(curSupersededBy)?.frontmatter.supersedes === baseFm.id;
    const isValidProposalAcceptance =
      baseStatus === "proposed" && curStatus === "accepted" && curSupersededBy === baseSupersededBy;
    const baseApplies = Array.isArray(baseFm.applies_to) ? baseFm.applies_to : [];
    const allGovernedPathsDeleted =
      baseApplies.length === 0 || baseApplies.every((p) => !fs.existsSync(path.join(root, p)));
    const isValidDeprecation =
      baseWasActive && curStatus === "deprecated" && curSupersededBy === baseSupersededBy;

    if (isValidDeprecation) {
      if (!allGovernedPathsDeleted) {
        errors.push(
          `${prefix} Frontmatter tampering: cannot transition from "${baseStatus}" to "deprecated" relative to ${baseRefLabel} while governed applies_to paths still exist on disk.`,
        );
      }
    } else if (!isValidSupersede && !isValidProposalAcceptance) {
      errors.push(
        `${prefix} Frontmatter tampering: disallowed status transition "${baseStatus}" -> "${curStatus}" relative to ${baseRefLabel}.`,
      );
    }
  }

  // 4. Protected applies_to and enforced_by paths (cannot drop paths that still exist on disk)
  const baseApplies = Array.isArray(baseFm.applies_to) ? baseFm.applies_to : [];
  const curApplies = Array.isArray(curFm.applies_to) ? curFm.applies_to : [];
  const baseEnforced = Array.isArray(baseFm.enforced_by) ? baseFm.enforced_by : [];
  const curEnforced = Array.isArray(curFm.enforced_by) ? curFm.enforced_by : [];

  for (const oldApplies of baseApplies) {
    if (!curApplies.includes(oldApplies) && fs.existsSync(path.join(root, oldApplies))) {
      errors.push(
        `${prefix} Frontmatter tampering: applies_to path "${oldApplies}" was removed while still present on disk (compared against ${baseRefLabel}).`,
      );
    }
  }

  for (const oldEnforced of baseEnforced) {
    if (!curEnforced.includes(oldEnforced) && fs.existsSync(path.join(root, oldEnforced))) {
      errors.push(
        `${prefix} Frontmatter tampering: enforced_by path "${oldEnforced}" was removed while still present on disk (compared against ${baseRefLabel}).`,
      );
    }
  }
}

function validateGitImmutability(
  root: string,
  adrDir: string,
  adrs: AdrRecord[],
  adrMap: Map<string, AdrRecord>,
  explicitBaseRef: string | undefined,
  errors: string[],
): void {
  const adrDirRel = normalizeRepoRelPath(path.relative(root, adrDir));

  if (!adrDirRel || adrDirRel.startsWith("..")) {
    return;
  }

  const baseRefs = resolveBaseRefs(root, explicitBaseRef, errors);

  if (baseRefs.length === 0) {
    return;
  }

  const curByRelPath = new Map<string, AdrRecord>();

  for (const adr of adrs) {
    curByRelPath.set(normalizeRepoRelPath(path.relative(root, adr.filePath)), adr);
  }

  for (const baseRef of baseRefs) {
    const listed = execGitRaw(["ls-tree", "-r", "--name-only", baseRef.sha, "--", adrDirRel], root);

    if (listed === null) {
      errors.push(`Git anchoring error: unable to list "${adrDirRel}" at ${baseRef.label}.`);
      continue;
    }

    const baseFiles = listed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((relPath) => {
        if (!relPath || !relPath.endsWith(".md")) return false;

        return (
          path.posix.dirname(relPath) === adrDirRel && path.posix.basename(relPath) !== "README.md"
        );
      });

    const baseContents = readGitFilesBatch(root, baseRef.sha, baseFiles);

    for (const relPath of baseFiles) {
      const baseRaw = baseContents.get(relPath) ?? null;

      if (baseRaw === null) {
        errors.push(`Git anchoring error: unable to read "${relPath}" at ${baseRef.label}.`);
        continue;
      }

      const baseParsed = parseFrontmatter(baseRaw);

      if (!baseParsed.frontmatter?.id) {
        // Pre-MADR legacy ADR without YAML frontmatter
        continue;
      }

      const absPath = path.join(root, relPath);

      if (!fs.existsSync(absPath)) {
        errors.push(
          `[${baseParsed.frontmatter.id}] Committed ADR "${relPath}" was deleted or moved (present in ${baseRef.label}). ADRs form an immutable flat log.`,
        );
        continue;
      }

      const curAdr = curByRelPath.get(relPath);

      if (!curAdr) {
        errors.push(
          `[${baseParsed.frontmatter.id}] Committed ADR "${relPath}" lost valid YAML frontmatter (present in ${baseRef.label}).`,
        );
        continue;
      }

      validateAgainstBaseRecord(
        relPath,
        baseRef.label,
        baseParsed.frontmatter,
        baseParsed.body,
        curAdr,
        root,
        adrMap,
        errors,
      );
    }
  }
}

export function checkAdrs(opts: AdrCommandOptions = {}): AdrCheckResult {
  const { root, adrDir, modulesDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);
  const errors: string[] = [];

  const adrMap = new Map<string, AdrRecord>();

  for (const adr of adrs) {
    const id = adr.frontmatter.id;

    if (id) {
      if (adrMap.has(id)) {
        errors.push(`[${id}] Duplicate ADR id detected in "${adr.fileName}".`);
      } else {
        adrMap.set(id, adr);
      }
    }
  }

  for (const adr of adrs) {
    validateAdrStructure(adr, root, adrMap, errors);
  }

  validateGitImmutability(root, adrDir, adrs, adrMap, opts.baseRef, errors);

  // Zero drift verification for docs/adr/README.md
  const readmePath = path.join(adrDir, "README.md");

  if (fs.existsSync(readmePath)) {
    const currentReadme = fs.readFileSync(readmePath, "utf8").replace(/\r\n/g, "\n");
    const expectedReadme = generateAdrReadme(adrs).replace(/\r\n/g, "\n");

    if (currentReadme !== expectedReadme) {
      errors.push("Drift detected in docs/adr/README.md. Run `pnpm adr sync` to reconcile index.");
    }
  }

  // Zero drift verification for src/modules/*/README.md
  if (fs.existsSync(modulesDir)) {
    const modules = fs.readdirSync(modulesDir);

    for (const mod of modules) {
      const modReadme = path.join(modulesDir, mod, "README.md");

      if (!fs.existsSync(modReadme)) continue;

      const current = fs.readFileSync(modReadme, "utf8").replace(/\r\n/g, "\n");
      const governing = getGoverningAdrsForPath(`src/modules/${mod}`, adrs);
      const expected = updateModuleReadmeContent(current, governing).replace(/\r\n/g, "\n");

      if (current !== expected) {
        errors.push(
          `Drift detected in src/modules/${mod}/README.md. Run \`pnpm adr sync\` to reconcile.`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function cmdCheck(opts: AdrCommandOptions = {}): boolean {
  const { valid, errors } = checkAdrs(opts);
  const { adrDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);

  if (!valid) {
    if (!opts.silent) {
      console.error(`\n\x1b[31m[ADR Check Failed]\x1b[0m ${errors.length} violation(s) found:\n`);

      for (const err of errors) {
        console.error(`  - ${err}`);
      }

      console.error("");
    }

    if (!opts.noExit) {
      process.exit(1);
    }

    return false;
  }

  if (!opts.silent) {
    console.log(
      `\n\x1b[32m[ADR Check Passed]\x1b[0m All ${adrs.length} ADRs comply with MADR 4.0 and immutability invariants.\n`,
    );
  }

  return true;
}

// ---------------------------------------------------------------------------
// Command: new
// ---------------------------------------------------------------------------
function splitCsvArg(value: string | boolean | string[] | undefined): string[] | undefined {
  if (typeof value !== "string") return undefined;

  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function cmdNew(
  args: Partial<ParsedCliArgs>,
  opts: AdrCommandOptions = {},
): AdrNewResult | null {
  const title = typeof args.title === "string" ? args.title : undefined;

  if (!title) {
    console.error("Error: --title is required");
    if (!opts.noExit) process.exit(1);

    return null;
  }

  const { adrDir } = getContext(opts);
  const area = typeof args.area === "string" ? args.area : "Architecture & Layout";
  const status = typeof args.status === "string" ? args.status : "accepted";
  const appliesTo = splitCsvArg(args["applies-to"]) ?? [];
  const enforcedBy = splitCsvArg(args["enforced-by"]) ?? [];
  const decisionMakers = splitCsvArg(args["decision-makers"]) ?? [
    "Product Owner",
    "Architect Agent",
  ];

  const adrs = loadAllAdrs(adrDir);
  const nextNum = getNextAdrNumber(adrs);
  const nextId = `ADR-${String(nextNum).padStart(4, "0")}`;
  const fileName = `${String(nextNum).padStart(4, "0")}-${buildAdrSlug(title)}.md`;
  const filePath = path.join(adrDir, fileName);
  const today = new Date().toISOString().slice(0, 10);

  const body = `
# ${nextId}: ${title}

## Context and Problem Statement

Describe the context and problem statement here.

## Decision Drivers

- Driver 1
- Driver 2

## Decision Outcome

Chosen option: **${title}**, because rationale.

## Confirmation and Enforcement

- Automated check via \`pnpm adr:check\`.

## Consequences

### Positive

- Enables clean modular structure.

### Negative

- Requires adherence to architectural contracts.

## Rejected Alternatives

- **Alternative A**: Description of why it was rejected.
`.trimStart();

  const fm: AdrFrontmatter = {
    id: nextId,
    title,
    status,
    date: today,
    "decision-makers": decisionMakers,
    area,
    applies_to: appliesTo,
    enforced_by: enforcedBy,
    supersedes: null,
    superseded_by: null,
  };

  fs.mkdirSync(adrDir, { recursive: true });
  fs.writeFileSync(filePath, serializeFrontmatter(fm, body), "utf8");
  cmdSync(opts);

  if (!opts.silent) {
    console.log(`Created new ADR: ${filePath}`);
  }

  return { id: nextId, fileName, filePath };
}

// ---------------------------------------------------------------------------
// Command: supersede
// ---------------------------------------------------------------------------
function buildSupersededBody(
  oldBody: string,
  oldId: string,
  oldFileName: string,
  nextId: string,
  title: string,
): string {
  const normalized = oldBody.replace(/\r\n/g, "\n").trimStart();
  const supersedesLine = `Supersedes [${oldId}](./${oldFileName}).`;

  const bodyWithHeading = /^# [^\n]+/.test(normalized)
    ? normalized.replace(/^# [^\n]+/, `# ${nextId}: ${title}`)
    : `# ${nextId}: ${title}\n\n${normalized}`;

  const contextHeadingPattern = /^(## Context and Problem Statement[ \t]*\n+)/m;
  const updated = contextHeadingPattern.test(bodyWithHeading)
    ? bodyWithHeading.replace(
        contextHeadingPattern,
        `## Context and Problem Statement\n\n${supersedesLine}\n\n`,
      )
    : `${bodyWithHeading.trimEnd()}\n\n## Context and Problem Statement\n\n${supersedesLine}\n`;

  return updated.endsWith("\n") ? updated : `${updated}\n`;
}

export function cmdSupersede(
  oldIdInput: string | undefined,
  args: Partial<ParsedCliArgs>,
  opts: AdrCommandOptions = {},
): AdrSupersedeResult | null {
  if (!oldIdInput) {
    console.error("Error: old-id is required");
    if (!opts.noExit) process.exit(1);

    return null;
  }

  const oldId = normalizeAdrId(oldIdInput);
  const { adrDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);
  const oldAdr = adrs.find((a) => a.frontmatter.id === oldId);

  if (!oldAdr) {
    console.error(`Error: ADR "${oldId}" not found.`);
    if (!opts.noExit) process.exit(1);

    return null;
  }

  const title =
    typeof args.title === "string"
      ? args.title
      : `Supersedes ${oldId}: ${oldAdr.frontmatter.title ?? ""}`;
  const area = typeof args.area === "string" ? args.area : (oldAdr.frontmatter.area ?? "");
  const appliesTo = splitCsvArg(args["applies-to"]) ?? [...(oldAdr.frontmatter.applies_to || [])];
  const enforcedBy = splitCsvArg(args["enforced-by"]) ?? [
    ...(oldAdr.frontmatter.enforced_by || []),
  ];
  const decisionMakers = splitCsvArg(args["decision-makers"]) ?? [
    "Product Owner",
    "Architect Agent",
  ];

  const nextNum = getNextAdrNumber(adrs);
  const nextId = `ADR-${String(nextNum).padStart(4, "0")}`;
  const fileName = `${String(nextNum).padStart(4, "0")}-${buildAdrSlug(title)}.md`;
  const filePath = path.join(adrDir, fileName);
  const today = new Date().toISOString().slice(0, 10);
  const body = buildSupersededBody(oldAdr.body, oldId, oldAdr.fileName, nextId, title);

  const newFm: AdrFrontmatter = {
    id: nextId,
    title,
    status: "accepted",
    date: today,
    "decision-makers": decisionMakers,
    area,
    applies_to: appliesTo,
    enforced_by: enforcedBy,
    supersedes: oldId,
    superseded_by: null,
  };

  fs.writeFileSync(filePath, serializeFrontmatter(newFm, body), "utf8");

  // Update old ADR frontmatter ONLY (preserving body verbatim)
  oldAdr.frontmatter.status = `superseded by ${nextId}`;
  oldAdr.frontmatter.superseded_by = nextId;

  fs.writeFileSync(oldAdr.filePath, serializeFrontmatter(oldAdr.frontmatter, oldAdr.body), "utf8");

  cmdSync(opts);

  if (!opts.silent) {
    console.log(`Superseded ${oldId} -> created ${nextId}: ${filePath}`);
  }

  return { nextId, filePath };
}

// ---------------------------------------------------------------------------
// Command: deprecate
// ---------------------------------------------------------------------------
export function cmdDeprecate(
  idInput: string | undefined,
  opts: AdrCommandOptions = {},
): AdrRecord | null {
  if (!idInput) {
    console.error("Error: id is required");
    if (!opts.noExit) process.exit(1);

    return null;
  }

  const id = normalizeAdrId(idInput);
  const { adrDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);
  const adr = adrs.find((a) => a.frontmatter.id === id);

  if (!adr) {
    console.error(`Error: ADR "${id}" not found.`);
    if (!opts.noExit) process.exit(1);

    return null;
  }

  adr.frontmatter.status = "deprecated";

  fs.writeFileSync(adr.filePath, serializeFrontmatter(adr.frontmatter, adr.body), "utf8");

  cmdSync(opts);

  if (!opts.silent) {
    console.log(`Deprecated ${id}: ${adr.filePath}`);
  }

  return adr;
}

// ---------------------------------------------------------------------------
// Command: retarget
// ---------------------------------------------------------------------------
export function cmdRetarget(
  oldPathInput: string | undefined,
  newPathInput: string | undefined,
  opts: AdrCommandOptions = {},
): number {
  if (!oldPathInput || !newPathInput) {
    console.error("Error: old-path and new-path are required");
    if (!opts.noExit) process.exit(1);

    return 0;
  }

  const oldPath = normalizeRepoRelPath(oldPathInput);
  const newPath = normalizeRepoRelPath(newPathInput);
  const { adrDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);
  let count = 0;

  const replacePath = (p: string): string => {
    const norm = normalizeRepoRelPath(p);

    if (norm === oldPath) return newPath;
    if (norm.startsWith(`${oldPath}/`)) return newPath + norm.slice(oldPath.length);

    return p;
  };

  for (const a of adrs) {
    if (a.frontmatter.status !== "accepted") continue;

    let modified = false;

    if (Array.isArray(a.frontmatter.applies_to)) {
      a.frontmatter.applies_to = a.frontmatter.applies_to.map((p) => {
        const rep = replacePath(p);

        if (rep !== p) modified = true;

        return rep;
      });
    }

    if (Array.isArray(a.frontmatter.enforced_by)) {
      a.frontmatter.enforced_by = a.frontmatter.enforced_by.map((p) => {
        const rep = replacePath(p);

        if (rep !== p) modified = true;

        return rep;
      });
    }

    if (modified) {
      fs.writeFileSync(a.filePath, serializeFrontmatter(a.frontmatter, a.body), "utf8");
      count++;
    }
  }

  cmdSync(opts);

  if (!opts.silent) {
    console.log(`Retargeted "${oldPath}" -> "${newPath}" across ${count} active ADR(s).`);
  }

  return count;
}

// ---------------------------------------------------------------------------
// Command: remove-path
// ---------------------------------------------------------------------------
export function cmdRemovePath(
  targetPathInput: string | undefined,
  opts: AdrCommandOptions = {},
): number {
  if (!targetPathInput) {
    console.error("Error: path is required");
    if (!opts.noExit) process.exit(1);

    return 0;
  }

  const targetPath = normalizeRepoRelPath(targetPathInput);
  const { adrDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);
  let modifiedCount = 0;

  const matchesTarget = (p: string): boolean => {
    const norm = normalizeRepoRelPath(p);

    return norm === targetPath || norm.startsWith(`${targetPath}/`);
  };

  for (const a of adrs) {
    if (a.frontmatter.status !== "accepted") continue;

    const applies = a.frontmatter.applies_to || [];
    const enforced = a.frontmatter.enforced_by || [];

    if (!applies.some(matchesTarget) && !enforced.some(matchesTarget)) {
      continue;
    }

    const remainingApplies = applies.filter((p) => !matchesTarget(p));

    if (remainingApplies.length === 0) {
      // Exclusively governed the removed path -> auto-deprecate while preserving historical paths
      a.frontmatter.status = "deprecated";

      if (!opts.silent) {
        console.log(
          `ADR ${a.frontmatter.id ?? ""} exclusively governed "${targetPath}"; auto-deprecating.`,
        );
      }
    } else {
      a.frontmatter.applies_to = remainingApplies;

      if (Array.isArray(a.frontmatter.enforced_by)) {
        a.frontmatter.enforced_by = enforced.filter((p) => !matchesTarget(p));
      }
    }

    fs.writeFileSync(a.filePath, serializeFrontmatter(a.frontmatter, a.body), "utf8");
    modifiedCount++;
  }

  cmdSync(opts);

  if (!opts.silent) {
    console.log(`Processed removal of path "${targetPath}" across ${modifiedCount} ADR(s).`);
  }

  return modifiedCount;
}

// ---------------------------------------------------------------------------
// CLI Argument Parsing & Router
// ---------------------------------------------------------------------------
export function parseArgs(rawArgs: string[]): ParsedCliArgs {
  const result: ParsedCliArgs = { _: [] };

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (arg.startsWith("--")) {
      const key = arg.slice(2);

      if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith("--")) {
        result[key] = rawArgs[i + 1];
        i++;
      } else {
        result[key] = true;
      }
    } else {
      result._.push(arg);
    }
  }

  return result;
}

function main(): void {
  const rawArgs = process.argv.slice(2);
  const parsed = parseArgs(rawArgs);
  const command = parsed._[0] || "help";

  switch (command) {
    case "list":
      cmdList(parsed);
      break;

    case "sync":
      cmdSync();
      break;

    case "check":
      cmdCheck({ baseRef: typeof parsed.base === "string" ? parsed.base : undefined });
      break;

    case "new":
      cmdNew(parsed);
      break;

    case "supersede":
      cmdSupersede(parsed._[1], parsed);
      break;

    case "deprecate":
      cmdDeprecate(parsed._[1]);
      break;

    case "retarget":
      cmdRetarget(parsed._[1], parsed._[2]);
      break;

    case "remove-path":
      cmdRemovePath(parsed._[1]);
      break;

    case "help":

    default:
      console.log(`
Z-Trader Architectural Decision Records (ADR) CLI

Usage:
  pnpm adr list [--path <path>] [--all] [--json]
  pnpm adr:check [--base <git-ref>]
  pnpm adr sync
  pnpm adr new --title <title> --area <area> [--applies-to <p1,p2>] [--enforced-by <e1,e2>]
  pnpm adr supersede <old-id> --title <title> [--area <area>]
  pnpm adr deprecate <id>
  pnpm adr retarget <old-path> <new-path>
  pnpm adr remove-path <path>
`);
      break;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
