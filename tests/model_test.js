// Unit tests for Model.js (the widget's pure helpers). Run with: node tests/model_test.js
// Model.js is a QML JavaScript library; it exports through `module.exports`
// only when loaded by Node, so it can be required directly here.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Model = require(path.join(__dirname, "..", "Model.js"));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { console.log("FAIL " + name + "\n     " + (e && e.message)); process.exitCode = 1; }
}

const s0 = Model.emptyState();

// parseLine
test("parseLine accepts a known event", () => {
  assert.deepEqual(Model.parseLine('{"event":"hello","protocol":1,"version":"0.2.0"}'),
    { event: "hello", protocol: 1, version: "0.2.0" });
});
test("parseLine rejects blank, partial and non-object lines", () => {
  for (const line of ["", "   ", '{"event":"vol', "[1,2]", "42", "null", '"hello"', undefined, null]) {
    assert.equal(Model.parseLine(line), null, String(line));
  }
});
test("parseLine rejects unknown events", () => {
  assert.equal(Model.parseLine('{"event":"telemetry"}'), null);
  assert.equal(Model.parseLine('{"drives":[]}'), null);
});

// applyEvent
test("applyEvent hello records the protocol", () => {
  assert.equal(Model.applyEvent(s0, { event: "hello", protocol: 1, version: "0.2.0" }).protocol, 1);
});
test("applyEvent volumes stores drives, marks data present and clears the error", () => {
  const withError = Model.applyEvent(s0, { event: "error", message: "udisks2 connection lost" });
  const s = Model.applyEvent(withError, { event: "volumes", drives: [{ id: "a", volumes: [] }] });
  assert.equal(s.hasVolumes, true);
  assert.equal(s.drives.length, 1);
  assert.equal(s.lastError, "");
});
test("applyEvent leaves state alone when a payload is malformed", () => {
  for (const ev of [{ event: "volumes" }, { event: "volumes", drives: "x" }, { event: "io", drives: null },
                    { event: "health", drives: {} }, { event: "bogus" }, null]) {
    assert.equal(Model.applyEvent(s0, ev), s0, JSON.stringify(ev));
  }
});
test("applyEvent io records current rates and keeps a bounded history", () => {
  let s = s0;
  for (let i = 0; i < Model.HISTORY + 5; i++) {
    s = Model.applyEvent(s, { event: "io", drives: [{ device: "/dev/sda", read_bps: i, write_bps: 2 * i }] });
  }
  const last = Model.HISTORY + 4;
  assert.deepEqual(s.io["/dev/sda"], { read: last, write: 2 * last });
  assert.equal(s.history["/dev/sda"].length, Model.HISTORY);
  assert.equal(s.history["/dev/sda"][Model.HISTORY - 1].read, last);
});
test("applyEvent io skips entries without a device and clamps bad numbers", () => {
  const s = Model.applyEvent(s0, { event: "io", drives: [null, { read_bps: 5 },
    { device: "/dev/sda", read_bps: "x", write_bps: -3 }] });
  assert.deepEqual(Object.keys(s.io), ["/dev/sda"]);
  assert.deepEqual(s.io["/dev/sda"], { read: 0, write: 0 });
});
test("applyEvent health is keyed by drive id", () => {
  const s = Model.applyEvent(s0, { event: "health", drives: [{ drive_id: "/d/1", temperature_c: 40 }, { model: "no id" }] });
  assert.deepEqual(Object.keys(s.health), ["/d/1"]);
  assert.equal(s.health["/d/1"].temperature_c, 40);
});
test("applyEvent error sets lastError", () => {
  assert.equal(Model.applyEvent(s0, { event: "error", message: "boom" }).lastError, "boom");
});
test("applyEvent never mutates its input", () => {
  const before = JSON.stringify(s0);
  Model.applyEvent(s0, { event: "io", drives: [{ device: "/dev/sda", read_bps: 1, write_bps: 1 }] });
  Model.applyEvent(s0, { event: "volumes", drives: [] });
  Model.applyEvent(s0, { event: "health", drives: [] });
  assert.equal(JSON.stringify(s0), before);
});

// formatSize / formatRate
test("formatSize mirrors gazania's human_size", () => {
  assert.equal(Model.formatSize(0), "0B");
  assert.equal(Model.formatSize(1023), "1023B");
  assert.equal(Model.formatSize(1536), "1.5K");
  assert.equal(Model.formatSize(12582912), "12M");
  assert.equal(Model.formatSize(3250585), "3.1M");
  assert.equal(Model.formatSize(475 * 1024 ** 3), "475G");
  assert.equal(Model.formatSize(-5), "0B");
  assert.equal(Model.formatSize("x"), "0B");
});
test("formatRate appends /s", () => {
  assert.equal(Model.formatRate(12582912), "12M/s");
});

console.log("\n" + passed + " passed" + (process.exitCode ? ", some FAILED" : ""));
