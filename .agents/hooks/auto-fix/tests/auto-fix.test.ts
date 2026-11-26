import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { extractTargetFilePath, runAutoFixHook } from "../core.ts";

describe("auto-fix hook", () => {
  const workspaceRoot = path.resolve("/repo/z-trader");

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

  it("runs eslint --fix then prettier --write on JS/TS files inside workspace", () => {
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
      eslintRan: true,
      prettierRan: true,
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
      eslintRan: false,
      prettierRan: true,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["--write", "--ignore-unknown", targetFile]);
  });

  it("continues to prettier even if eslint exits with unfixable errors", () => {
    const targetFile = path.join(workspaceRoot, "src", "broken.ts");
    const runNodeScript = vi
      .fn<(scriptPath: string, args: string[], cwd: string) => void>()
      .mockImplementationOnce(() => {
        throw new Error("lint error");
      })
      .mockImplementationOnce(() => undefined);

    const result = runAutoFixHook(
      {
        workspacePaths: [workspaceRoot],
        toolCall: { args: { Path: targetFile } },
      },
      workspaceRoot,
      {
        exists: () => true,
        isFile: () => true,
        runNodeScript,
      },
    );

    expect(result.status).toBe("fixed");
    expect(result.eslintRan).toBe(true);
    expect(result.prettierRan).toBe(true);
    expect(runNodeScript).toHaveBeenCalledTimes(2);
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
