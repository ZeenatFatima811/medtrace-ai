import { describe, expect, it } from "vitest";
import { searchManual } from "./manual-search";

const pages = [
  { page: 1, text: "Model IP-200 Volumetric Infusion Pump\nService Guide" },
  { page: 3, text: "Section 5\nE-101 Air-in-line\nE-104 Downstream occlusion.\nEscalate repeated alarms" },
  { page: 4, text: "6.1 Occlusion alarms (E104): pressure above threshold" },
];

describe("searchManual", () => {
  it("cites the exact pages containing the error code, tolerant of hyphens", () => {
    const r = searchManual(pages, ["E-104"], "IP-200");
    expect(r.passages.map((p) => p.page).sort()).toEqual([3, 4]);
  });

  it("returns no evidence when the error code is absent from the manual", () => {
    const r = searchManual(pages, ["E-555"], "IP-200");
    expect(r.passages).toHaveLength(0);
  });

  it("does not match a code that is only a prefix of another code", () => {
    const r = searchManual(pages, ["E-10"], null);
    expect(r.passages).toHaveLength(0);
  });

  it("flags a manual that never mentions the device model", () => {
    expect(searchManual(pages, ["E-104"], "XR-900").modelMentioned).toBe(false);
    expect(searchManual(pages, ["E-104"], "IP200").modelMentioned).toBe(true);
  });
});
