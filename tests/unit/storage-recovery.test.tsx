import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageRecoveryBanner } from "@/app/components/storage-recovery-banner";
import { useWorkspace } from "@/app/hooks/use-workspace";
import type { WorkspaceStorageEnvelope } from "@/app/types/workspace";

const WORKSPACE_KEY = "z-trader-workspace-v1";

function WorkspaceHarness() {
  const { state, retry, startEmpty } = useWorkspace();
  if (state.status === "corrupted") {
    return (
      <StorageRecoveryBanner
        status="corrupted"
        onRetry={retry}
        onStartEmpty={startEmpty}
      />
    );
  }
  return (
    <div>
      <span data-testid="workspace-id">{state.workspace.activeWorkspaceId}</span>
      {state.status === "unavailable" ? (
        <StorageRecoveryBanner status="unavailable" />
      ) : null}
    </div>
  );
}

describe("StorageRecoveryBanner and workspace recovery flow", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("renders corrupted recovery copy and delays onRetry by 250ms with disabled/aria-busy state", async () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const onStartEmpty = vi.fn();

    render(
      <StorageRecoveryBanner
        status="corrupted"
        onRetry={onRetry}
        onStartEmpty={onStartEmpty}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Unable to restore your workspace" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "The saved workspace is corrupted or has an unsupported format. Retry to read it again, or start empty to replace it with a new workspace.",
      ),
    ).toBeTruthy();

    const retryButton = screen.getByRole("button", { name: "Retry" });
    const startEmptyButton = screen.getByRole("button", { name: "Start empty" });
    expect((retryButton as HTMLButtonElement).disabled).toBe(false);
    expect(retryButton.getAttribute("aria-busy")).not.toBe("true");
    expect((startEmptyButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(retryButton);
    expect((retryButton as HTMLButtonElement).disabled).toBe(true);
    expect(retryButton.getAttribute("aria-busy")).toBe("true");
    expect(onRetry).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(onRetry).not.toHaveBeenCalled();
    expect((retryButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect((retryButton as HTMLButtonElement).disabled).toBe(false);
    expect(retryButton.getAttribute("aria-busy")).not.toBe("true");
  });

  it("cancels a pending Retry timer when Start empty is clicked or when unmounted", async () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const onStartEmpty = vi.fn();

    const { unmount } = render(
      <StorageRecoveryBanner
        status="corrupted"
        onRetry={onRetry}
        onStartEmpty={onStartEmpty}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Start empty" }));
    expect(onStartEmpty).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onRetry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("renders a non-blocking status warning when storage is unavailable", () => {
    render(<StorageRecoveryBanner status="unavailable" />);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain(
      "Local storage is unavailable. Changes in this session will not be saved.",
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start empty" })).toBeNull();
  });

  it("recovers via Retry when the stored record is repaired, or replaces it on Start empty", async () => {
    vi.useFakeTimers();
    const broken = "{corrupted";
    window.localStorage.setItem(WORKSPACE_KEY, broken);

    render(
      <Suspense fallback={null}>
        <WorkspaceHarness />
      </Suspense>,
    );

    expect(
      screen.getByRole("heading", { name: "Unable to restore your workspace" }),
    ).toBeTruthy();
    expect(window.localStorage.getItem(WORKSPACE_KEY)).toBe(broken);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(
      screen.getByRole("heading", { name: "Unable to restore your workspace" }),
    ).toBeTruthy();
    expect(window.localStorage.getItem(WORKSPACE_KEY)).toBe(broken);

    const repaired: WorkspaceStorageEnvelope = {
      version: 1,
      activeWorkspaceId: "repaired-ws",
      workspaces: [{ id: "repaired-ws", windows: [] }],
    };
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(repaired));

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByTestId("workspace-id").textContent).toBe("repaired-ws");
    expect(
      screen.queryByRole("heading", { name: "Unable to restore your workspace" }),
    ).toBeNull();
  });

  it("replaces corrupted storage with a fresh empty workspace on Start empty", () => {
    window.localStorage.setItem(WORKSPACE_KEY, "{corrupted");

    render(
      <Suspense fallback={null}>
        <WorkspaceHarness />
      </Suspense>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start empty" }));

    const activeId = screen.getByTestId("workspace-id").textContent;
    expect(activeId).toBeTruthy();
    const saved = JSON.parse(
      window.localStorage.getItem(WORKSPACE_KEY)!,
    ) as WorkspaceStorageEnvelope;
    expect(saved.activeWorkspaceId).toBe(activeId);
    expect(saved.workspaces).toEqual([{ id: activeId, windows: [] }]);
  });
});
