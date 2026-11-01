// @vitest-environment jsdom
// Service eyes: small projects map by themselves, larger ones wait
// for a click, and explicit choices always win over the default.
import { describe, expect, it } from "vitest";
import { SERVICE_EYE_THRESHOLD, serviceEyeOpen } from "./serviceEyes";

describe("serviceEyeOpen", () => {
  it("opens every service at 3 or fewer, like examples/reservas", () => {
    expect(SERVICE_EYE_THRESHOLD).toBe(3);
    expect(serviceEyeOpen("a::fe", {}, {}, 2)).toBe(true);
    expect(serviceEyeOpen("a::fe", {}, {}, 3)).toBe(true);
  });

  it("closes never-opened services above 3 detected", () => {
    expect(serviceEyeOpen("a::s1", {}, {}, 4)).toBe(false);
    expect(serviceEyeOpen("a::s1", {}, {}, 12)).toBe(false);
  });

  it("opens a recorded service however many exist", () => {
    expect(serviceEyeOpen("a::s1", {}, { "a::s1": true }, 12)).toBe(true);
  });

  it("lets an explicit hide win over everything", () => {
    expect(serviceEyeOpen("a::s1", { "a::s1": true }, { "a::s1": true }, 2)).toBe(false);
  });

  it("lets an explicit open win over the default", () => {
    expect(serviceEyeOpen("a::s1", { "a::s1": false }, {}, 12)).toBe(true);
  });

  it("ignores other services' entries", () => {
    expect(
      serviceEyeOpen("a::s1", { "a::s2": true }, { "a::s2": true }, 12),
    ).toBe(false);
    expect(serviceEyeOpen("a::s1", { "a::s2": false }, {}, 2)).toBe(true);
  });
});
