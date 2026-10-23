import { describe, expect, it } from "vitest";
import { parseFindings } from "./parse-findings";

const VALID = JSON.stringify({
  visibleDeviceInfo: { manufacturer: "NovaFlow", deviceType: "Pump", model: "IP-200", serial: null },
  errorCodes: ["E-104"],
  visibleErrorText: ["DOWNSTREAM OCCLUSION"],
  screenDescription: "Infusion pump alarm screen.",
  confidence: "high",
  uncertaintyNotes: "Serial label not visible.",
  unreadable: ["serial label"],
  followUpQuestions: ["Was the line kinked?"],
});

describe("parseFindings", () => {
  it("parses a valid model response into findings", () => {
    const f = parseFindings(VALID);
    expect(f).not.toBeNull();
    expect(f?.errorCodes).toEqual(["E-104"]);
    expect(f?.confidence).toBe("high");
    expect(f?.visibleDeviceInfo.model).toBe("IP-200");
  });

  it("extracts JSON embedded in surrounding text", () => {
    expect(parseFindings(`Here you go:\n${VALID}\nDone.`)).not.toBeNull();
  });

  it("returns null when the response contains no JSON object", () => {
    expect(parseFindings("Sorry, I cannot read this image.")).toBeNull();
    expect(parseFindings("{not valid json")).toBeNull();
  });

  it("falls back to low confidence for unexpected values", () => {
    expect(parseFindings(VALID.replace('"high"', '"certain"'))?.confidence).toBe("low");
  });
});
