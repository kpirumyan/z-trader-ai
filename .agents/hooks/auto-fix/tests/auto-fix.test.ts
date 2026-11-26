import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractTargetFilePath, flushAutoFixDiagnostics, runAutoFixHook } from "../core.ts";

describe("auto-fix hook", () => {
  const workspaceRoot = path.resolve("/repo/z-trader");
  let diagnosticsDir: string;

  beforeEach(() => {
    diagnosticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-fix-test-"));
  });

  afterEach(() => {
    fs.rmSync(diagnosticsDir, { recursive: true, force: true });
  });

  it("extracts target file paths from supported tool arg shapes", () => {
    expect(extractTargetFilePath({ toolCall: { args: { Path: "src/app/page.tsx" } } })).toBe(
      "src/app/page.tsx",
    );

    expect(extractTargetFilePath({ toolCall: { args: { TargetFile: "src/index.ts" } } })).toBe(
      "src/index.ts",
    );

    expect(extractTargetFilePath({ toolCall: { args: { file_path: "README.md" } } })).toBe(
      "README.md",
    );

    expect(extractTargetFilePath({ toolCall: { args: {} } })).toBeUndefined();
  });

  it("runs eslint --fix --max-warnings 0 then prettier --write on JS/TS files", () => {
    const calls: Array<{ scriptPath: string; args: string[]; cwd: string }> = [];
    const targetFile = path.join(workspaceRoot, "src", "example.ts");

    const result = runAutoFixHook(
      {
        conversationId: "conv-1",
        workspacePaths: [workspaceRoot],
        cwd: workspaceRoot,
        toolCall: {
          name: "edit_file",
          args: { Path: targetFile },
        },
      },
      workspaceRoot,
      {
        diagnosticsDir,
        exists: () => true,
        isFile: () => true,
        runNodeScript: (scriptPath, args, cwd) => {
          calls.push({ scriptPath, args, cwd });
        },
      },
    );

    expect(result).toEqual({
      status: "fixed",
      filePath: targetFile,
      eslintRan: true,
      prettierRan: true,
      diagnostics: [],
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.scriptPath).toContain("eslint.js");
    expect(calls[0]?.args).toEqual(["--fix", "--max-warnings", "0", targetFile]);
    expect(calls[1]?.scriptPath).toContain("prettier.cjs");
    expect(calls[1]?.args).toEqual(["--write", targetFile]);
  });

  it("runs only prettier with --ignore-unknown on non-code files", () => {
    const calls: Array<{ scriptPath: string; args: string[]; cwd: string }> = [];
    const targetFile = path.join(workspaceRoot, "docs", "notes.md");

    const result = runAutoFixHook(
      {
        conversationId: "conv-1",
        workspacePaths: [workspaceRoot],
        cwd: workspaceRoot,
        toolCall: {
          name: "write_file",
          args: { Path: "docs/notes.md" },
        },
      },
      workspaceRoot,
      {
        diagnosticsDir,
        exists: () => true,
        isFile: () => true,
        runNodeScript: (scriptPath, args, cwd) => {
          calls.push({ scriptPath, args, cwd });
        },
      },
    );

    expect(result).toEqual({
      status: "fixed",
      filePath: targetFile,
      eslintRan: false,
      prettierRan: true,
      diagnostics: [],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.scriptPath).toContain("prettier.cjs");
    expect(calls[0]?.args).toEqual(["--write", "--ignore-unknown", targetFile]);
  });

  it("captures unfixable eslint and prettier errors and flushes them via PostInvocation", () => {
    const targetFile = path.join(workspaceRoot, "src", "broken.ts");
    const eslintErr = Object.assign(new Error("eslint failed"), {
      stdout: "src/broken.ts:1:1 error Unexpected any",
    });
    const runNodeScript = vi
      .fn<(scriptPath: string, args: string[], cwd: string) => void>()
      .mockImplementationOnce(() => {
        throw eslintErr;
      })
      .mockImplementationOnce(() => {
        throw new Error("SyntaxError: Unexpected token");
      });

    const result = runAutoFixHook(
      {
        conversationId: "conv-err",
        workspacePaths: [workspaceRoot],
        toolCall: { args: { Path: targetFile } },
      },
      workspaceRoot,
      {
        diagnosticsDir,
        exists: () => true,
        isFile: () => true,
        runNodeScript,
      },
    );

    expect(result.status).toBe("failed");
    expect(result.eslintRan).toBe(true);
    expect(result.prettierRan).toBe(true);

    expect(result.diagnostics).toEqual([
      { tool: "eslint", message: "src/broken.ts:1:1 error Unexpected any" },
      { tool: "prettier", message: "SyntaxError: Unexpected token" },
    ]);

    const flushed = flushAutoFixDiagnostics(
      { conversationId: "conv-err", workspacePaths: [workspaceRoot] },
      workspaceRoot,
      { diagnosticsDir },
    );

    expect(flushed.injectSteps).toHaveLength(1);
    expect(flushed.injectSteps?.[0]?.systemMessage.systemMessage).toContain("src/broken.ts");
    expect(flushed.injectSteps?.[0]?.systemMessage.systemMessage).toContain("Unexpected any");

    expect(
      flushAutoFixDiagnostics(
        { conversationId: "conv-err", workspacePaths: [workspaceRoot] },
        workspaceRoot,
        { diagnosticsDir },
      ),
    ).toEqual({});
  });

  it("clears pending diagnostics when a subsequent edit fixes the file", () => {
    const targetFile = path.join(workspaceRoot, "src", "recoverable.ts");
    const runNodeScript = vi
      .fn<(scriptPath: string, args: string[], cwd: string) => void>()
      .mockImplementationOnce(() => {
        throw new Error("lint error");
      })
      .mockImplementation(() => {});

    const failed = runAutoFixHook(
      {
        conversationId: "conv-recover",
        workspacePaths: [workspaceRoot],
        toolCall: { args: { Path: targetFile } },
      },
      workspaceRoot,
      { diagnosticsDir, exists: () => true, isFile: () => true, runNodeScript },
    );

    expect(failed.status).toBe("failed");

    const fixed = runAutoFixHook(
      {
        conversationId: "conv-recover",
        workspacePaths: [workspaceRoot],
        toolCall: { args: { Path: targetFile } },
      },
      workspaceRoot,
      { diagnosticsDir, exists: () => true, isFile: () => true, runNodeScript },
    );

    expect(fixed.status).toBe("fixed");

    expect(
      flushAutoFixDiagnostics(
        { conversationId: "conv-recover", workspacePaths: [workspaceRoot] },
        workspaceRoot,
        { diagnosticsDir },
      ),
    ).toEqual({});
  });

  it("skips failed tools, outside-workspace paths, and ignored directories", () => {
    const runNodeScript = vi.fn();

    expect(
      runAutoFixHook(
        { error: "edit failed", toolCall: { args: { Path: "src/a.ts" } } },
        workspaceRoot,
        { diagnosticsDir, exists: () => true, isFile: () => true, runNodeScript },
      ),
    ).toMatchObject({ status: "skipped", reason: "tool-failed", diagnostics: [] });

    expect(
      runAutoFixHook(
        {
          workspacePaths: [workspaceRoot],
          toolCall: { args: { Path: path.resolve("/outside/artifact.md") } },
        },
        workspaceRoot,
        { diagnosticsDir, exists: () => true, isFile: () => true, runNodeScript },
      ),
    ).toMatchObject({ status: "skipped", reason: "outside-workspace", diagnostics: [] });

    expect(
      runAutoFixHook(
        {
          workspacePaths: [workspaceRoot],
          toolCall: { args: { Path: ".next/types/foo.ts" } },
        },
        workspaceRoot,
        { diagnosticsDir, exists: () => true, isFile: () => true, runNodeScript },
      ),
    ).toMatchObject({ status: "skipped", reason: "ignored-path", diagnostics: [] });

    expect(runNodeScript).not.toHaveBeenCalled();
  });
});
