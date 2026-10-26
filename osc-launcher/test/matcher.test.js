const { test, describe } = require("node:test");
const assert = require("node:assert");
const { matchesOscPattern, isIpAllowed } = require("../osc-utils");

describe("OSC Pattern Matching", () => {
  test("exact address matches", () => {
    assert.strictEqual(matchesOscPattern("/cue/1/go", "/cue/1/go"), true);
    assert.strictEqual(matchesOscPattern("/cue/1/go", "/cue/1/stop"), false);
    assert.strictEqual(matchesOscPattern("/cue/1/go", "/cue/2/go"), false);
  });

  test("wildcard (*) matches within path segment", () => {
    assert.strictEqual(matchesOscPattern("/track/*/play", "/track/1/play"), true);
    assert.strictEqual(matchesOscPattern("/track/*/play", "/track/guitar/play"), true);
    assert.strictEqual(matchesOscPattern("/track/*/play", "/track/1/2/play"), false);
    assert.strictEqual(matchesOscPattern("/track/*", "/track/test"), true);
    assert.strictEqual(matchesOscPattern("/*", "/anything"), true);
  });

  test("single character (?) wildcard", () => {
    assert.strictEqual(matchesOscPattern("/channel/?/mute", "/channel/1/mute"), true);
    assert.strictEqual(matchesOscPattern("/channel/?/mute", "/channel/A/mute"), true);
    assert.strictEqual(matchesOscPattern("/channel/?/mute", "/channel/12/mute"), false);
  });

  test("choice sets ({a,b})", () => {
    assert.strictEqual(matchesOscPattern("/deck/{A,B}/cue", "/deck/A/cue"), true);
    assert.strictEqual(matchesOscPattern("/deck/{A,B}/cue", "/deck/B/cue"), true);
    assert.strictEqual(matchesOscPattern("/deck/{A,B}/cue", "/deck/C/cue"), false);
    assert.strictEqual(matchesOscPattern("/{on,off}", "/on"), true);
    assert.strictEqual(matchesOscPattern("/{on,off}", "/off"), true);
  });

  test("character ranges ([0-9]) and negations ([!0-9])", () => {
    assert.strictEqual(matchesOscPattern("/scene/[1-4]", "/scene/1"), true);
    assert.strictEqual(matchesOscPattern("/scene/[1-4]", "/scene/3"), true);
    assert.strictEqual(matchesOscPattern("/scene/[1-4]", "/scene/4"), true);
    assert.strictEqual(matchesOscPattern("/scene/[1-4]", "/scene/5"), false);

    assert.strictEqual(matchesOscPattern("/slot/[!0-9]", "/slot/A"), true);
    assert.strictEqual(matchesOscPattern("/slot/[!0-9]", "/slot/1"), false);
  });

  test("null, empty and invalid input handling", () => {
    assert.strictEqual(matchesOscPattern("", "/cue/1"), false);
    assert.strictEqual(matchesOscPattern("/cue/1", ""), false);
    assert.strictEqual(matchesOscPattern(null, "/cue/1"), false);
    assert.strictEqual(matchesOscPattern(undefined, undefined), false);
  });
});

describe("IP Whitelist Checking", () => {
  test("allows all if whitelist is empty or blank", () => {
    assert.strictEqual(isIpAllowed("192.168.1.100", ""), true);
    assert.strictEqual(isIpAllowed("127.0.0.1", "   "), true);
    assert.strictEqual(isIpAllowed("10.0.0.5", null), true);
  });

  test("validates against authorized IPs", () => {
    const whitelist = "127.0.0.1, 192.168.1.50, 10.0.0.1";
    assert.strictEqual(isIpAllowed("127.0.0.1", whitelist), true);
    assert.strictEqual(isIpAllowed("192.168.1.50", whitelist), true);
    assert.strictEqual(isIpAllowed("192.168.1.99", whitelist), false);
  });

  test("handles empty remote address", () => {
    assert.strictEqual(isIpAllowed("", "127.0.0.1"), false);
    assert.strictEqual(isIpAllowed(null, "127.0.0.1"), false);
  });
});
