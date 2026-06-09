import { describe, expect, it } from "vitest";

import { cn, sortByRole } from "./utils";

describe("cn", () => {
  it("merges tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("sortByRole", () => {
  it("orders admin, mentor, intern", () => {
    const rows = [
      { role: "intern", id: 1 },
      { role: "admin", id: 2 },
      { role: "mentor", id: 3 },
    ];
    const sorted = sortByRole(rows, "role");
    expect(sorted.map((r) => r.role)).toEqual(["admin", "mentor", "intern"]);
  });
});
