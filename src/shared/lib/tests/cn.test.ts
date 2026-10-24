import { describe, expect, it } from "vitest";
import { cn } from "@/src/shared/lib";

describe("shared-lib: cn", () => {
  it("merges conditional and dynamic styles without leaking falsy values", () => {
    // Given
    const hasActive = false;
    const isPrimary = true;

    // When
    const result = cn(
      "btn",
      hasActive && "btn-active",
      null,
      undefined,
      "",
      isPrimary && "btn-primary",
    );

    // Then
    expect(result).toBe("btn btn-primary");
  });

  it("handles empty or all-falsy arguments by returning an empty string", () => {
    expect(cn()).toBe("");
    expect(cn(null, undefined, false, "")).toBe("");
  });

  it("supports object and array syntax for conditional classes", () => {
    const result = cn("base", ["nested-1", false && "nested-falsy", ["deep-nested"]], {
      "is-open": true,
      "is-closed": false,
    });

    expect(result).toBe("base nested-1 deep-nested is-open");
  });

  it("concatenates multiple string arguments separated by single space", () => {
    expect(cn("px-4", "py-2", "text-sm")).toBe("px-4 py-2 text-sm");
  });
});
