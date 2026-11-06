#!/usr/bin/env node
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// ---------------------------------------------------------------------------
// Root & Paths
// ---------------------------------------------------------------------------
function findProjectRoot() {
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
const LOCK_FILE = path.join(ADR_DIR, ".adr-lock.json");
const MODULES_DIR = path.join(ROOT_DIR, "src", "modules");

export function getContext(opts = {}) {
  const root = opts.rootDir || process.env.ADR_ROOT_DIR || ROOT_DIR;
  const adrDir = opts.adrDir || (opts.rootDir ? path.join(opts.rootDir, "docs", "adr") : ADR_DIR);
  const lockFile = opts.lockFile || path.join(adrDir, ".adr-lock.json");
  const modulesDir = opts.modulesDir || (opts.rootDir ? path.join(opts.rootDir, "src", "modules") : MODULES_DIR);

  return { root, adrDir, lockFile, modulesDir };
}

const CANONICAL_SECTIONS = [
  "Context and Problem Statement",
  "Decision Drivers",
  "Decision Outcome",
  "Confirmation and Enforcement",
  "Consequences",
  "Rejected Alternatives",
];

// ---------------------------------------------------------------------------
// YAML Frontmatter Parser & Serializer (Zero External Dependencies)
// ---------------------------------------------------------------------------
export function parseFrontmatter(raw) {
  const norm = raw.replace(/\r\n/g, "\n");
  const match = norm.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    return { frontmatter: null, body: norm };
  }

  const fmText = match[1];
  const body = match[2];
  const lines = fmText.split("\n");
  const data = {};

  let currentKey = null;
  let currentArray = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    if (line.startsWith("  - ")) {
      const val = line.slice(4).trim().replace(/^["']|["']$/g, "");

      if (currentArray) {
        currentArray.push(val);
      }

      continue;
    }

    const colonIdx = line.indexOf(":");

    if (colonIdx !== -1 && !line.startsWith(" ") && !line.startsWith("\t")) {
      currentKey = line.slice(0, colonIdx).trim();

      let rawVal = line.slice(colonIdx + 1).trim();

      if (rawVal === "" || rawVal === "[]") {
        currentArray = [];
        data[currentKey] = currentArray;
      } else if (rawVal === "null") {
        data[currentKey] = null;
        currentArray = null;
      } else {
        rawVal = rawVal.replace(/^["']|["']$/g, "");
        data[currentKey] = rawVal;
        currentArray = null;
      }
    }
  }

  return { frontmatter: data, body };
}

export function serializeFrontmatter(data, body) {
  const lines = ["---"];

  if (data.id !== undefined) lines.push(`id: "${data.id}"`);
  if (data.title !== undefined) lines.push(`title: "${data.title}"`);
  if (data.status !== undefined) lines.push(`status: "${data.status}"`);
  if (data.date !== undefined) lines.push(`date: "${data.date}"`);

  if (data["decision-makers"] && Array.isArray(data["decision-makers"])) {
    lines.push("decision-makers:");

    for (const dm of data["decision-makers"]) {
      lines.push(`  - "${dm}"`);
    }
  }

  if (data.area !== undefined) lines.push(`area: "${data.area}"`);

  if (data.applies_to && Array.isArray(data.applies_to)) {
    lines.push("applies_to:");

    for (const p of data.applies_to) {
      lines.push(`  - "${p}"`);
    }
  }

  if (data.enforced_by && Array.isArray(data.enforced_by)) {
    lines.push("enforced_by:");

    for (const p of data.enforced_by) {
      lines.push(`  - "${p}"`);
    }
  }

  lines.push(`supersedes: ${data.supersedes ? `"${data.supersedes}"` : "null"}`);

  lines.push(
    `superseded_by: ${data.superseded_by ? `"${data.superseded_by}"` : "null"}`
  );

  lines.push("---");
  lines.push("");

  const trimmedBody = body.replace(/^\n+/, "");

  return lines.join("\n") + trimmedBody;
}

// ---------------------------------------------------------------------------
// Cryptographic Body Hash
// ---------------------------------------------------------------------------
export function computeBodyHash(body) {
  const normalized = body.replace(/\r\n/g, "\n").trim();

  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function readLockFile(customLockFile) {
  const targetPath = customLockFile || LOCK_FILE;

  if (!fs.existsSync(targetPath)) {
    return { version: 1, records: {} };
  }

  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

export function writeLockFile(lockData, customLockFile) {
  const targetPath = customLockFile || LOCK_FILE;
  const sortedRecords = {};

  for (const k of Object.keys(lockData.records).sort()) {
    sortedRecords[k] = lockData.records[k];
  }

  const payload = {
    version: 1,
    records: sortedRecords,
  };

  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Load & Parse All ADRs
// ---------------------------------------------------------------------------
export function loadAllAdrs(customAdrDir) {
  const targetDir = customAdrDir || ADR_DIR;

  if (!fs.existsSync(targetDir)) return [];

  const entries = fs.readdirSync(targetDir);
  const adrs = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md") || entry === "README.md") continue;

    const filePath = path.join(targetDir, entry);
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

  return adrs.sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id));
}

// ---------------------------------------------------------------------------
// Generator: docs/adr/README.md
// ---------------------------------------------------------------------------
export function generateAdrReadme(adrs) {
  const activeAdrs = adrs.filter((a) =>
    ["accepted", "proposed"].includes(a.frontmatter.status)
  );
  const historicalAdrs = adrs.filter((a) =>
    !["accepted", "proposed"].includes(a.frontmatter.status)
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
    "- **AI Agent Filtering & Enforcement**: Coding agents and automated path gates enforce only active decisions (`status: \"accepted\"`). Use `pnpm adr:list --module <name>` to query active decisions for a domain module, and `pnpm adr:check` to validate compliance.",
    "",
    "## Active Decisions Index",
    "",
    "| ID                                                                   | Title                                                                        | Status   | Date       | Area                    |",
    "| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- | ---------- | ----------------------- |",
  ];

  for (const a of activeAdrs) {
    const idLink = `[${a.frontmatter.id}](./${a.fileName})`;
    const title = a.frontmatter.title;
    const status = a.frontmatter.status;
    const date = a.frontmatter.date;
    const area = a.frontmatter.area;

    const pad = (str, len) => str.padEnd(len, " ");

    lines.push(
      `| ${pad(idLink, 68)} | ${pad(title, 76)} | ${pad(status, 8)} | ${pad(date, 10)} | ${pad(area, 23)} |`
    );
  }

  if (historicalAdrs.length > 0) {
    lines.push("");
    lines.push("## Historical Decisions Index");
    lines.push("");

    lines.push(
      "| ID                                                                   | Title                                                                        | Status   | Date       | Area                    |"
    );

    lines.push(
      "| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- | ---------- | ----------------------- |"
    );

    for (const a of historicalAdrs) {
      const idLink = `[${a.frontmatter.id}](./${a.fileName})`;
      const title = a.frontmatter.title;
      const status = a.frontmatter.status;
      const date = a.frontmatter.date;
      const area = a.frontmatter.area;

      const pad = (str, len) => str.padEnd(len, " ");

      lines.push(
        `| ${pad(idLink, 68)} | ${pad(title, 76)} | ${pad(status, 8)} | ${pad(date, 10)} | ${pad(area, 23)} |`
      );
    }
  }

  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Generator: src/modules/*/README.md Governing ADRs
// ---------------------------------------------------------------------------
export function getGoverningAdrsForModule(moduleName, adrs) {
  const moduleRelPath = `src/modules/${moduleName}`;

  return adrs
    .filter((a) => {
      if (a.frontmatter.status !== "accepted") return false;

      const applies = a.frontmatter.applies_to || [];

      return applies.some(
        (p) =>
          p === moduleRelPath ||
          p.startsWith(`${moduleRelPath}/`) ||
          p === "src/shared" && moduleRelPath.startsWith("src/shared")
      );
    })
    .sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id));
}

export function updateModuleReadmeContent(content, governingAdrs) {
  const headingIdx = content.indexOf("## Governing ADRs");
  const beforeSection = headingIdx !== -1 ? content.slice(0, headingIdx) : content.trim() + "\n\n";

  const lines = ["## Governing ADRs", ""];

  if (governingAdrs.length === 0) {
    lines.push("*No module-specific governing ADRs.*");
  } else {
    for (const a of governingAdrs) {
      lines.push(
        `- [${a.frontmatter.id}: ${a.frontmatter.title}](../../../docs/adr/${a.fileName}) \u2014 ${a.frontmatter.area}`
      );
    }
  }

  return beforeSection.trimEnd() + "\n\n" + lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Command: list
// ---------------------------------------------------------------------------
export function cmdList(args, opts = {}) {
  const { adrDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);
  const moduleFilter = args.module;
  const showAll = args.all;
  const asJson = args.json;

  let filtered = adrs;

  if (!showAll) {
    filtered = filtered.filter((a) => ["accepted", "proposed"].includes(a.frontmatter.status));
  }

  if (moduleFilter) {
    const modClean = moduleFilter.replace(/^src\/modules\//, "");
    const targetPath = `src/modules/${modClean}`;

    filtered = filtered.filter((a) => {
      const applies = a.frontmatter.applies_to || [];

      return applies.some((p) => p === targetPath || p.startsWith(`${targetPath}/`));
    });
  }

  if (asJson) {
    const out = filtered.map((a) => ({
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
    console.log(
      `\nFound ${filtered.length} ADR(s)${moduleFilter ? ` for module "${moduleFilter}"` : ""}:\n`
    );

    console.log(
      `${"ID".padEnd(10)} | ${"Status".padEnd(10)} | ${"Area".padEnd(25)} | Title`
    );

    console.log("-".repeat(80));

    for (const a of filtered) {
      const id = (a.frontmatter.id || "").padEnd(10);
      const status = (a.frontmatter.status || "").padEnd(10);
      const area = (a.frontmatter.area || "").padEnd(25);

      console.log(`${id} | ${status} | ${area} | ${a.frontmatter.title}`);
    }

    console.log("");
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Command: sync
// ---------------------------------------------------------------------------
export function cmdSync(opts = {}) {
  const { adrDir, modulesDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);

  // 1. docs/adr/README.md
  const readmeContent = generateAdrReadme(adrs);
  const readmePath = path.join(adrDir, "README.md");

  fs.writeFileSync(readmePath, readmeContent, "utf8");

  if (!opts.silent) {
    console.log("Synchronized docs/adr/README.md");
  }

  // 2. src/modules/*/README.md
  if (fs.existsSync(modulesDir)) {
    const modules = fs.readdirSync(modulesDir);

    for (const mod of modules) {
      const modReadme = path.join(modulesDir, mod, "README.md");

      if (!fs.existsSync(modReadme)) continue;

      const current = fs.readFileSync(modReadme, "utf8");
      const governing = getGoverningAdrsForModule(mod, adrs);
      const updated = updateModuleReadmeContent(current, governing);

      fs.writeFileSync(modReadme, updated, "utf8");

      if (!opts.silent) {
        console.log(`Synchronized src/modules/${mod}/README.md (${governing.length} ADRs)`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Command: check & Validator Core
// ---------------------------------------------------------------------------
export function checkAdrs(opts = {}) {
  const { root, adrDir, lockFile, modulesDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);
  const lock = readLockFile(lockFile);
  const errors = [];

  // Git HEAD anchoring verification for .adr-lock.json
  let headLockRecords = null;

  try {
    const headLockRaw = execSync("git show HEAD:docs/adr/.adr-lock.json", {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });

    headLockRecords = JSON.parse(headLockRaw).records;
  } catch {
    // If not in git or file not in HEAD, skip head anchoring
  }

  if (headLockRecords) {
    for (const [id, headHash] of Object.entries(headLockRecords)) {
      const currentHash = lock.records[id];

      if (!currentHash) {
        errors.push(
          `Lockfile tampering: record "${id}" was removed from docs/adr/.adr-lock.json (present in git HEAD).`
        );
      } else if (currentHash !== headHash) {
        errors.push(
          `Lockfile tampering: hash for "${id}" was altered in docs/adr/.adr-lock.json (HEAD: ${headHash}, working: ${currentHash}).`
        );
      }
    }
  }

  const adrMap = new Map();

  for (const a of adrs) {
    adrMap.set(a.frontmatter.id, a);
  }

  for (const a of adrs) {
    const fm = a.frontmatter;
    const prefix = `[${fm.id || a.fileName}]`;

    // 1. Frontmatter schema validation
    if (!fm.id || !/^ADR-\d{4}$/.test(fm.id)) {
      errors.push(`${prefix} Invalid or missing id. Must match /^ADR-\\d{4}$/`);
    }

    if (!fm.title || typeof fm.title !== "string" || !fm.title.trim()) {
      errors.push(`${prefix} Missing title`);
    }

    const validStatuses = [
      "proposed",
      "accepted",
      "rejected",
      "deprecated",
    ];
    const isSuperseded =
      typeof fm.status === "string" && fm.status.startsWith("superseded by ADR-");

    if (!validStatuses.includes(fm.status) && !isSuperseded) {
      errors.push(
        `${prefix} Invalid status "${fm.status}". Allowed: proposed, accepted, rejected, deprecated, or "superseded by ADR-XXXX"`
      );
    }

    if (!fm.date || !/^\d{4}-\d{2}-\d{2}$/.test(fm.date)) {
      errors.push(`${prefix} Invalid date "${fm.date}". Must be YYYY-MM-DD.`);
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

    // 2. Canonical 6 H2 sections in exact order
    const h2Matches = [...a.body.matchAll(/^##\s+([^\r\n]+)/gm)].map((m) =>
      m[1].trim()
    );
    let lastFoundIdx = -1;

    for (const expectedSec of CANONICAL_SECTIONS) {
      const idx = h2Matches.indexOf(expectedSec);

      if (idx === -1) {
        errors.push(`${prefix} Missing canonical section: "## ${expectedSec}"`);
      } else if (idx <= lastFoundIdx) {
        errors.push(
          `${prefix} Canonical section out of order: "## ${expectedSec}"`
        );
      } else {
        lastFoundIdx = idx;
      }
    }

    // 3. Bidirectional superseding check
    if (fm.supersedes) {
      const target = adrMap.get(fm.supersedes);

      if (!target) {
        errors.push(`${prefix} supersedes "${fm.supersedes}" which does not exist.`);
      } else {
        if (target.frontmatter.superseded_by !== fm.id) {
          errors.push(
            `${prefix} supersedes "${fm.supersedes}", but ${fm.supersedes} does not link back with superseded_by: "${fm.id}"`
          );
        }

        if (target.frontmatter.status !== `superseded by ${fm.id}`) {
          errors.push(
            `${prefix} supersedes "${fm.supersedes}", but ${fm.supersedes} status is "${target.frontmatter.status}", expected "superseded by ${fm.id}"`
          );
        }
      }
    }

    if (fm.superseded_by) {
      const target = adrMap.get(fm.superseded_by);

      if (!target) {
        errors.push(
          `${prefix} superseded_by "${fm.superseded_by}" which does not exist.`
        );
      } else if (target.frontmatter.supersedes !== fm.id) {
        errors.push(
          `${prefix} superseded_by "${fm.superseded_by}", but ${fm.superseded_by} does not declare supersedes: "${fm.id}"`
        );
      }
    }

    // 4. Active path existence check (accepted only)
    if (fm.status === "accepted") {
      for (const p of fm.applies_to || []) {
        const resolved = path.join(root, p);

        if (!fs.existsSync(resolved)) {
          errors.push(
            `${prefix} Active applies_to path does not exist on filesystem: "${p}"`
          );
        }
      }

      for (const p of fm.enforced_by || []) {
        const resolved = path.join(root, p);

        if (!fs.existsSync(resolved)) {
          errors.push(
            `${prefix} Active enforced_by path does not exist on filesystem: "${p}"`
          );
        }
      }
    }

    // 5. Cryptographic body hash check
    const hash = computeBodyHash(a.body);
    const lockedHash = lock.records[fm.id];

    if (!lockedHash) {
      errors.push(`${prefix} Missing entry in docs/adr/.adr-lock.json`);
    } else if (lockedHash !== hash) {
      errors.push(
        `${prefix} Body hash mismatch! Locked: ${lockedHash}, Calculated: ${hash}. Direct body modification is prohibited.`
      );
    }
  }

  // 6. Zero drift verification for docs/adr/README.md
  const readmePath = path.join(adrDir, "README.md");

  if (fs.existsSync(readmePath)) {
    const currentReadme = fs.readFileSync(readmePath, "utf8").replace(/\r\n/g, "\n");
    const expectedReadme = generateAdrReadme(adrs).replace(/\r\n/g, "\n");

    if (currentReadme !== expectedReadme) {
      errors.push(
        "Drift detected in docs/adr/README.md. Run `pnpm adr:sync` to reconcile index."
      );
    }
  }

  // 7. Zero drift verification for src/modules/*/README.md
  if (fs.existsSync(modulesDir)) {
    const modules = fs.readdirSync(modulesDir);

    for (const mod of modules) {
      const modReadme = path.join(modulesDir, mod, "README.md");

      if (!fs.existsSync(modReadme)) continue;

      const current = fs.readFileSync(modReadme, "utf8").replace(/\r\n/g, "\n");
      const governing = getGoverningAdrsForModule(mod, adrs);
      const expected = updateModuleReadmeContent(current, governing).replace(/\r\n/g, "\n");

      if (current !== expected) {
        errors.push(
          `Drift detected in src/modules/${mod}/README.md. Run ` + "`pnpm adr:sync` to reconcile."
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function cmdCheck(opts = {}) {
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
    console.log(`\n\x1b[32m[ADR Check Passed]\x1b[0m All ${adrs.length} ADRs comply with MADR 4.0 and immutability invariants.\n`);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Command: new
// ---------------------------------------------------------------------------
export function cmdNew(args, opts = {}) {
  const title = args.title;

  if (!title) {
    console.error("Error: --title is required");
    if (!opts.noExit) process.exit(1);

    return null;
  }

  const { adrDir, lockFile } = getContext(opts);
  const area = args.area || "Architecture & Layout";
  const status = args.status || "accepted";
  const appliesTo = args["applies-to"] ? args["applies-to"].split(",").map((s) => s.trim()) : [];
  const enforcedBy = args["enforced-by"] ? args["enforced-by"].split(",").map((s) => s.trim()) : [];
  const decisionMakers = args["decision-makers"]
    ? args["decision-makers"].split(",").map((s) => s.trim())
    : ["Product Owner", "Architect Agent"];

  const adrs = loadAllAdrs(adrDir);
  let maxNum = -1;

  for (const a of adrs) {
    const num = parseInt(a.frontmatter.id.replace("ADR-", ""), 10);

    if (!isNaN(num) && num > maxNum) maxNum = num;
  }

  const nextNum = maxNum + 1;
  const nextId = `ADR-${String(nextNum).padStart(4, "0")}`;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const fileName = `${String(nextNum).padStart(4, "0")}-${slug}.md`;
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

  const fm = {
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

  const fileContent = serializeFrontmatter(fm, body);

  fs.writeFileSync(filePath, fileContent, "utf8");

  // Lock the body hash
  const hash = computeBodyHash(body);
  const lock = readLockFile(lockFile);

  lock.records[nextId] = hash;
  writeLockFile(lock, lockFile);

  cmdSync(opts);

  if (!opts.silent) {
    console.log(`Created new ADR: ${filePath}`);
  }

  return { id: nextId, fileName, filePath };
}

// ---------------------------------------------------------------------------
// Command: supersede
// ---------------------------------------------------------------------------
export function cmdSupersede(oldIdInput, args, opts = {}) {
  if (!oldIdInput) {
    console.error("Error: old-id is required");
    if (!opts.noExit) process.exit(1);

    return null;
  }

  const oldId = oldIdInput.startsWith("ADR-")
    ? oldIdInput
    : `ADR-${oldIdInput.padStart(4, "0")}`;

  const { adrDir, lockFile } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);
  const oldAdr = adrs.find((a) => a.frontmatter.id === oldId);

  if (!oldAdr) {
    console.error(`Error: ADR "${oldId}" not found.`);
    if (!opts.noExit) process.exit(1);

    return null;
  }

  const title = args.title || `Supersedes ${oldId}: ${oldAdr.frontmatter.title}`;
  const area = args.area || oldAdr.frontmatter.area;
  const appliesTo = args["applies-to"]
    ? args["applies-to"].split(",").map((s) => s.trim())
    : [...(oldAdr.frontmatter.applies_to || [])];
  const enforcedBy = args["enforced-by"]
    ? args["enforced-by"].split(",").map((s) => s.trim())
    : [...(oldAdr.frontmatter.enforced_by || [])];
  const decisionMakers = args["decision-makers"]
    ? args["decision-makers"].split(",").map((s) => s.trim())
    : ["Product Owner", "Architect Agent"];

  let maxNum = -1;

  for (const a of adrs) {
    const num = parseInt(a.frontmatter.id.replace("ADR-", ""), 10);

    if (!isNaN(num) && num > maxNum) maxNum = num;
  }

  const nextNum = maxNum + 1;
  const nextId = `ADR-${String(nextNum).padStart(4, "0")}`;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const fileName = `${String(nextNum).padStart(4, "0")}-${slug}.md`;
  const filePath = path.join(adrDir, fileName);

  const today = new Date().toISOString().slice(0, 10);

  const body = `
# ${nextId}: ${title}

## Context and Problem Statement

Supersedes [${oldId}](./${oldAdr.fileName}). Describe why a new decision is necessary.

## Decision Drivers

- Driver 1
- Driver 2

## Decision Outcome

Chosen option: **${title}**, because rationale.

## Confirmation and Enforcement

- Verified via \`pnpm adr:check\`.

## Consequences

### Positive

- Improved architecture.

### Negative

- Migration required.

## Rejected Alternatives

- **Keeping ${oldId}**: Insufficient for new requirements.
`.trimStart();

  const newFm = {
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

  // 1. Write new ADR
  fs.writeFileSync(filePath, serializeFrontmatter(newFm, body), "utf8");

  // 2. Update old ADR frontmatter ONLY (preserving body and body hash)
  oldAdr.frontmatter.status = `superseded by ${nextId}`;
  oldAdr.frontmatter.superseded_by = nextId;

  fs.writeFileSync(
    oldAdr.filePath,
    serializeFrontmatter(oldAdr.frontmatter, oldAdr.body),
    "utf8"
  );

  // 3. Lock new hash
  const hash = computeBodyHash(body);
  const lock = readLockFile(lockFile);

  lock.records[nextId] = hash;
  writeLockFile(lock, lockFile);

  cmdSync(opts);

  if (!opts.silent) {
    console.log(`Superseded ${oldId} -> created ${nextId}: ${filePath}`);
  }

  return { nextId, filePath };
}

// ---------------------------------------------------------------------------
// Command: deprecate
// ---------------------------------------------------------------------------
export function cmdDeprecate(idInput, opts = {}) {
  if (!idInput) {
    console.error("Error: id is required");
    if (!opts.noExit) process.exit(1);

    return null;
  }

  const id = idInput.startsWith("ADR-")
    ? idInput
    : `ADR-${idInput.padStart(4, "0")}`;

  const { adrDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);
  const adr = adrs.find((a) => a.frontmatter.id === id);

  if (!adr) {
    console.error(`Error: ADR "${id}" not found.`);
    if (!opts.noExit) process.exit(1);

    return null;
  }

  adr.frontmatter.status = "deprecated";

  fs.writeFileSync(
    adr.filePath,
    serializeFrontmatter(adr.frontmatter, adr.body),
    "utf8"
  );

  cmdSync(opts);

  if (!opts.silent) {
    console.log(`Deprecated ${id}: ${adr.filePath}`);
  }

  return adr;
}

// ---------------------------------------------------------------------------
// Command: retarget
// ---------------------------------------------------------------------------
export function cmdRetarget(oldPathInput, newPathInput, opts = {}) {
  if (!oldPathInput || !newPathInput) {
    console.error("Error: old-path and new-path are required");
    if (!opts.noExit) process.exit(1);

    return 0;
  }

  const oldPath = oldPathInput.replace(/\\/g, "/").replace(/\/+$/, "");
  const newPath = newPathInput.replace(/\\/g, "/").replace(/\/+$/, "");

  const { adrDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);
  let count = 0;

  const replacePath = (p) => {
    const norm = p.replace(/\\/g, "/");

    if (norm === oldPath) return newPath;

    if (norm.startsWith(`${oldPath}/`)) {
      return newPath + norm.slice(oldPath.length);
    }

    return p;
  };

  for (const a of adrs) {
    if (a.frontmatter.status !== "accepted") continue;

    let modified = false;

    if (Array.isArray(a.frontmatter.applies_to)) {
      const nextApplies = a.frontmatter.applies_to.map((p) => {
        const rep = replacePath(p);

        if (rep !== p) modified = true;

        return rep;
      });

      a.frontmatter.applies_to = nextApplies;
    }

    if (Array.isArray(a.frontmatter.enforced_by)) {
      const nextEnforced = a.frontmatter.enforced_by.map((p) => {
        const rep = replacePath(p);

        if (rep !== p) modified = true;

        return rep;
      });

      a.frontmatter.enforced_by = nextEnforced;
    }

    if (modified) {
      fs.writeFileSync(
        a.filePath,
        serializeFrontmatter(a.frontmatter, a.body),
        "utf8"
      );

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
export function cmdRemovePath(targetPathInput, opts = {}) {
  if (!targetPathInput) {
    console.error("Error: path is required");
    if (!opts.noExit) process.exit(1);

    return 0;
  }

  const targetPath = targetPathInput.replace(/\\/g, "/").replace(/\/+$/, "");
  const { adrDir } = getContext(opts);
  const adrs = loadAllAdrs(adrDir);
  let modifiedCount = 0;

  for (const a of adrs) {
    if (a.frontmatter.status !== "accepted") continue;

    const applies = (a.frontmatter.applies_to || []).map((p) => p.replace(/\\/g, "/"));
    const enforced = (a.frontmatter.enforced_by || []).map((p) => p.replace(/\\/g, "/"));

    const matchesTarget = (p) => p === targetPath || p.startsWith(`${targetPath}/`);
    const hasPath = applies.some(matchesTarget) || enforced.some(matchesTarget);

    if (hasPath) {
      const remainingApplies = applies.filter((p) => !matchesTarget(p));

      if (remainingApplies.length === 0) {
        // Exclusively governed the removed path -> auto-deprecate
        // Preserves historical applies_to/enforced_by
        a.frontmatter.status = "deprecated";

        if (!opts.silent) {
          console.log(
            `ADR ${a.frontmatter.id} exclusively governed "${targetPath}"; auto-deprecating.`
          );
        }
      } else {
        // Multi-module ADR: prune only the removed path
        a.frontmatter.applies_to = remainingApplies;

        if (Array.isArray(a.frontmatter.enforced_by)) {
          a.frontmatter.enforced_by = enforced.filter((p) => !matchesTarget(p));
        }
      }

      fs.writeFileSync(
        a.filePath,
        serializeFrontmatter(a.frontmatter, a.body),
        "utf8"
      );

      modifiedCount++;
    }
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
export function parseArgs(rawArgs) {
  const result = { _: [] };

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

export function main() {
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
      cmdCheck();
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
  node adr-cli.mjs list [--module <name>] [--all] [--json]
  node adr-cli.mjs check
  node adr-cli.mjs sync
  node adr-cli.mjs new --title <title> --area <area> [--applies-to <p1,p2>] [--enforced-by <e1,e2>]
  node adr-cli.mjs supersede <old-id> --title <title> [--area <area>]
  node adr-cli.mjs deprecate <id>
  node adr-cli.mjs retarget <old-path> <new-path>
  node adr-cli.mjs remove-path <path>
`);

      break;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  main();
}
