import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { extractTargetFilePath, runAutoFixHook, runPostInvocationHook } from "../core.ts";

describe("auto-fix hook", () => {
  const workspaceRoot = path.resolve("/repo/z-trader");
  const tempDirs: string[] = [];

  function createPendingDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-fix-test-"));

    tempDirs.push(dir);

    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

  it("runs only prettier --write on JS/TS files inside workspace", () => {
    const calls: Array<{ scriptPath: string; args: string[]; cwd: string }> = [];
    const targetFile = path.join(workspaceRoot, "src", "example.ts");

    const result = runAutoFixHook(
      {
        workspacePaths: [workspaceRoot],
        cwd: workspaceRoot,
        toolCall: {
          name: "edit_file",
          args: { Path: targetFile },
        },
      },
      workspaceRoot,
      {
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
      prettierRan: true,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.scriptPath).toContain("prettier.cjs");
    expect(calls[0]?.args).toEqual(["--write", targetFile]);
  });

  it("runs prettier with --ignore-unknown on non-code files", () => {
    const calls: Array<{ scriptPath: string; args: string[]; cwd: string }> = [];
    const targetFile = path.join(workspaceRoot, "docs", "notes.md");

    const result = runAutoFixHook(
      {
        workspacePaths: [workspaceRoot],
        cwd: workspaceRoot,
        toolCall: {
          name: "write_file",
          args: { Path: "docs/notes.md" },
        },
      },
      workspaceRoot,
      {
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
      prettierRan: true,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["--write", "--ignore-unknown", targetFile]);
  });

  it("reports prettier errors and injects a one-shot PostInvocation systemMessage", () => {
    const pendingDir = createPendingDir();
    const targetFile = path.join(workspaceRoot, "src", "broken.ts");
    const stderrError = Object.assign(new Error("Command failed"), {
      stderr: Buffer.from("[error] src/broken.ts: SyntaxError: Unexpected token (3:1)\n"),
    });
    const runNodeScript = vi
      .fn<(scriptPath: string, args: string[], cwd: string) => void>()
      .mockImplementationOnce(() => {
        throw stderrError;
      });

    const result = runAutoFixHook(
      {
        conversationId: "conv-123",
        workspacePaths: [workspaceRoot],
        toolCall: { args: { Path: targetFile } },
      },
      workspaceRoot,
      {
        pendingDir,
        exists: () => true,
        isFile: () => true,
        runNodeScript,
      },
    );

    expect(result).toEqual({
      status: "error",
      filePath: targetFile,
      prettierRan: true,
      error: "[error] src/broken.ts: SyntaxError: Unexpected token (3:1)",
    });

    expect(runNodeScript).toHaveBeenCalledTimes(1);

    const postOutput = runPostInvocationHook({ conversationId: "conv-123" }, { pendingDir });

    expect(postOutput.injectSteps).toHaveLength(1);
    expect(postOutput.injectSteps?.[0]?.systemMessage.systemMessage).toContain("src/broken.ts");

    expect(postOutput.injectSteps?.[0]?.systemMessage.systemMessage).toContain(
      "SyntaxError: Unexpected token (3:1)",
    );

    // Drained once: subsequent PostInvocation returns empty object
    expect(runPostInvocationHook({ conversationId: "conv-123" }, { pendingDir })).toEqual({});
  });

  it("clears pending prettier error when a subsequent edit fixes the same file", () => {
    const pendingDir = createPendingDir();
    const targetFile = path.join(workspaceRoot, "src", "fixed-later.ts");
    const runNodeScript = vi
      .fn<(scriptPath: string, args: string[], cwd: string) => void>()
      .mockImplementationOnce(() => {
        throw new Error("SyntaxError: mid-edit");
      })
      .mockImplementationOnce(() => {
        // Second edit succeeds
      });

    const first = runAutoFixHook(
      {
        conversationId: "conv-clear",
        workspacePaths: [workspaceRoot],
        toolCall: { args: { Path: targetFile } },
      },
      workspaceRoot,
      {
        pendingDir,
        exists: () => true,
        isFile: () => true,
        runNodeScript,
      },
    );

    expect(first.status).toBe("error");

    const second = runAutoFixHook(
      {
        conversationId: "conv-clear",
        workspacePaths: [workspaceRoot],
        toolCall: { args: { Path: targetFile } },
      },
      workspaceRoot,
      {
        pendingDir,
        exists: () => true,
        isFile: () => true,
        runNodeScript,
      },
    );

    expect(second.status).toBe("fixed");
    expect(runPostInvocationHook({ conversationId: "conv-clear" }, { pendingDir })).toEqual({});
  });

  it("skips failed tools, outside-workspace paths, and ignored directories", () => {
    const runNodeScript = vi.fn();

    expect(
      runAutoFixHook(
        { error: "edit failed", toolCall: { args: { Path: "src/a.ts" } } },
        workspaceRoot,
        { exists: () => true, isFile: () => true, runNodeScript },
      ),
    ).toMatchObject({ status: "skipped", reason: "tool-failed" });

    expect(
      runAutoFixHook(
        {
          workspacePaths: [workspaceRoot],
          toolCall: { args: { Path: path.resolve("/outside/artifact.md") } },
        },
        workspaceRoot,
        { exists: () => true, isFile: () => true, runNodeScript },
      ),
    ).toMatchObject({ status: "skipped", reason: "outside-workspace" });

    expect(
      runAutoFixHook(
        {
          workspacePaths: [workspaceRoot],
          toolCall: { args: { Path: ".next/types/foo.ts" } },
        },
        workspaceRoot,
        { exists: () => true, isFile: () => true, runNodeScript },
      ),
    ).toMatchObject({ status: "skipped", reason: "ignored-path" });

    expect(runNodeScript).not.toHaveBeenCalled();
  });
});
