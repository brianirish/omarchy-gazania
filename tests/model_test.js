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

// ---------- tracking and the bar ----------
function fixtureState() {
  const lines = fs.readFileSync(path.join(__dirname, "fixtures", "watch.jsonl"), "utf8").split("\n");
  return lines.reduce((s, line) => {
    const e = Model.parseLine(line);
    return e ? Model.applyEvent(s, e) : s;
  }, Model.emptyState());
}
const G = fixtureState();
const settings = (over) => Model.withDefaults(Object.assign({}, over));
const GLYPH = Model.GLYPH;
const SAMSUNG = "/org/freedesktop/UDisks2/drives/Samsung";

test("withDefaults fills gaps and rejects bad values", () => {
  assert.deepEqual(Model.withDefaults({}), Model.DEFAULTS);
  const s = Model.withDefaults({ barStat: "bogus", volume: "", warnAt: "90", criticalAt: null,
                                 showIo: false, showTemperature: "yes" });
  assert.equal(s.barStat, "free");
  assert.equal(s.volume, "/");
  assert.equal(s.warnAt, 90);
  assert.equal(s.criticalAt, 95);
  assert.equal(s.showIo, false);
  assert.equal(s.showTemperature, false);
});

test("trackedVolume finds the configured mount", () => {
  const t = Model.trackedVolume(G, settings({ volume: "/boot" }));
  assert.equal(t.mount, "/boot");
  assert.equal(t.volume.device, "/dev/nvme0n1p1");
  assert.equal(t.fallback, false);
});
test("trackedVolume matches any mount point of a volume", () => {
  const t = Model.trackedVolume(G, settings({ volume: "/home" }));
  assert.equal(t.volume.device, "/dev/mapper/root");
  assert.equal(t.mount, "/home");
});
test("trackedVolume falls back to / and says so", () => {
  const t = Model.trackedVolume(G, settings({ volume: "/mnt/usb" }));
  assert.equal(t.mount, "/");
  assert.equal(t.fallback, true);
});
test("trackedVolume falls back to the first mounted volume when / is missing", () => {
  const noRoot = Model.applyEvent(Model.emptyState(), { event: "volumes", drives: [{ id: "d", model: "M", device: "/dev/sdb",
    volumes: [{ id: "v", device: "/dev/sdb1", size: 10, usage: { used: 1, available: 9 },
                mount_points: [{ path: "/data", options: [] }] }] }] });
  const t = Model.trackedVolume(noRoot, settings({}));
  assert.equal(t.mount, "/data");
  assert.equal(t.fallback, true);
});
test("trackedVolume is null with nothing mounted", () => {
  assert.equal(Model.trackedVolume(Model.emptyState(), settings({})), null);
});

test("trackedDrive defaults to the drive hosting the tracked volume", () => {
  assert.equal(Model.trackedDrive(G, settings({})).device, "/dev/nvme0n1");
});
test("trackedDrive honours the drive setting", () => {
  assert.equal(Model.trackedDrive(G, settings({ drive: "/dev/sda" })).model, "Crucial_CT480M500SSD1");
});
test("trackedDrive is null for an unknown drive setting", () => {
  assert.equal(Model.trackedDrive(G, settings({ drive: "/dev/sdz" })), null);
});

test("usedPercent rounds up like df", () => {
  assert.equal(Model.usedPercent(G.drives[1].volumes[0]), 35);
  assert.equal(Model.usedPercent(G.drives[1].volumes[1]), 11);
  assert.equal(Model.usedPercent(G.drives[0].volumes[0]), null);
  assert.equal(Model.usedPercent({ usage: { used: 0, available: 0 } }), 0);
});
test("level switches at the warning and critical thresholds", () => {
  const s = settings({});
  assert.equal(Model.level(84, s), "normal");
  assert.equal(Model.level(85, s), "warning");
  assert.equal(Model.level(95, s), "error");
  assert.equal(Model.level(null, s), "normal");
});

test("barText free shows the free percent of the tracked volume", () => {
  assert.equal(Model.barText(G, settings({}), false), GLYPH + " 65%");
});
test("barText io shows read and write per second", () => {
  assert.equal(Model.barText(G, settings({ barStat: "io" }), false), GLYPH + " ↓12M ↑3.1M");
});
test("barText io without a rate shows a dash", () => {
  assert.equal(Model.barText(G, settings({ barStat: "io", drive: "/dev/sdz" }), false), GLYPH + " —");
  const noIo = Model.applyEvent(G, { event: "io", drives: [] });
  assert.equal(Model.barText(noIo, settings({ barStat: "io" }), false), GLYPH + " —");
});
test("barText temperature rounds to whole degrees", () => {
  assert.equal(Model.barText(G, settings({ barStat: "temperature" }), false), GLYPH + " 42°");
});
test("barText temperature without data shows a dash", () => {
  const noTemp = Model.applyEvent(G, { event: "health", drives: [{ drive_id: SAMSUNG, temperature_c: null,
                                                                  failing: false, warnings: [] }] });
  assert.equal(Model.barText(noTemp, settings({ barStat: "temperature" }), false), GLYPH + " —");
});
test("barText is the glyph alone for none and vertical bars, and a dash without data", () => {
  assert.equal(Model.barText(G, settings({ barStat: "none" }), false), GLYPH);
  assert.equal(Model.barText(G, settings({}), true), GLYPH);
  assert.equal(Model.barText(Model.emptyState(), settings({}), false), GLYPH + " —");
});

test("barLevel follows the tracked volume's usage", () => {
  assert.equal(Model.barLevel(G, settings({})), "normal");
  assert.equal(Model.barLevel(G, settings({ warnAt: 30 })), "warning");
  assert.equal(Model.barLevel(G, settings({ warnAt: 20, criticalAt: 35 })), "error");
});
test("barLevel for temperature is error only when the drive is failing", () => {
  assert.equal(Model.barLevel(G, settings({ barStat: "temperature" })), "normal");
  const failing = Model.applyEvent(G, { event: "health", drives: [{ drive_id: SAMSUNG, temperature_c: 70,
                                                                   failing: true, warnings: ["temperature"] }] });
  assert.equal(Model.barLevel(failing, settings({ barStat: "temperature" })), "error");
});

test("slotWidth fits the stat text", () => {
  assert.equal(Model.slotWidth(settings({}), false), 2);
  assert.equal(Model.slotWidth(settings({ barStat: "io" }), false), 4);
  assert.equal(Model.slotWidth(settings({ barStat: "temperature" }), false), 2);
  assert.equal(Model.slotWidth(settings({ barStat: "none" }), false), 1);
  assert.equal(Model.slotWidth(settings({ barStat: "io" }), true), 1);
});

test("tooltip explains a missing or outdated gazania", () => {
  assert.match(Model.tooltip(G, settings({}), "missing"), /Install the gazania package/);
  assert.match(Model.tooltip(G, settings({}), "outdated"), /Update gazania/);
});
test("tooltip says connecting before the first volumes event", () => {
  assert.equal(Model.tooltip(Model.emptyState(), settings({}), "connecting"), "Gazania: connecting…");
});
test("tooltip shows the tracked volume's usage", () => {
  assert.equal(Model.tooltip(G, settings({}), "ok"), "/\n164G of 475G used\n311G free");
});
test("tooltip names a configured mount that was not found", () => {
  assert.match(Model.tooltip(G, settings({ volume: "/mnt/usb" }), "ok"), /\/mnt\/usb not found, showing \//);
});
test("tooltip carries the last stream error", () => {
  const err = Model.applyEvent(G, { event: "error", message: "udisks2 connection lost" });
  assert.match(Model.tooltip(err, settings({}), "ok"), /udisks2 connection lost$/);
});

test("exitDecision: 127 means gazania is missing; recheck every minute", () => {
  assert.deepEqual(Model.exitDecision(127, false, "connecting", 8000), { status: "missing", retryMs: 60000, nextBackoffMs: 2000 });
});
test("exitDecision: usage error before hello means gazania is too old", () => {
  assert.deepEqual(Model.exitDecision(2, false, "connecting", 2000), { status: "outdated", retryMs: 0, nextBackoffMs: 2000 });
});
test("exitDecision: other exits restart with doubling backoff capped at 30 s", () => {
  assert.deepEqual(Model.exitDecision(2, true, "ok", 2000), { status: "connecting", retryMs: 2000, nextBackoffMs: 4000 });
  assert.deepEqual(Model.exitDecision(1, true, "ok", 16000), { status: "connecting", retryMs: 16000, nextBackoffMs: 30000 });
  assert.deepEqual(Model.exitDecision(0, true, "ok", 30000), { status: "connecting", retryMs: 30000, nextBackoffMs: 30000 });
});
test("exitDecision: an outdated stream stays stopped", () => {
  assert.deepEqual(Model.exitDecision(143, true, "outdated", 2000), { status: "outdated", retryMs: 0, nextBackoffMs: 2000 });
});

// ---------- panel view models ----------
test("heroSubtitle reports free space on the tracked volume", () => {
  assert.equal(Model.heroSubtitle(G, settings({}), "ok"), "311G free on /");
});
test("heroSubtitle explains missing data", () => {
  assert.equal(Model.heroSubtitle(Model.emptyState(), settings({}), "connecting"), "connecting");
  assert.equal(Model.heroSubtitle(G, settings({}), "missing"), "gazania is not installed");
  assert.equal(Model.heroSubtitle(G, settings({}), "outdated"), "gazania needs an update");
});

test("volumeRows lists every volume grouped by drive, in stream order", () => {
  const rows = Model.volumeRows(G, settings({}));
  assert.deepEqual(rows.map(r => r.label), ["SSD_480GB", "/dev/mapper/root", "/dev/nvme0n1p1"]);
  assert.deepEqual(rows.map(r => r.firstOfDrive), [true, true, false]);
  assert.deepEqual(rows.map(r => r.driveModel),
    ["Crucial_CT480M500SSD1", "Samsung SSD 960 PRO 512GB", "Samsung SSD 960 PRO 512GB"]);
});
test("volumeRows describes mounted and unmounted volumes", () => {
  const [ntfs, root, boot] = Model.volumeRows(G, settings({}));
  assert.equal(ntfs.mounts, "Not mounted");
  assert.equal(ntfs.mount, "");
  assert.equal(ntfs.sizeText, "447G");
  assert.equal(ntfs.freeText, "");
  assert.equal(ntfs.fraction, 0);
  assert.equal(root.mounts, "/, /home");
  assert.equal(root.mount, "/");
  assert.equal(root.sizeText, "164G of 475G");
  assert.equal(root.freeText, "311G free");
  assert.equal(root.fraction, 0.35);
  assert.equal(root.level, "normal");
  assert.equal(boot.level, "normal");
});
test("volumeRows levels follow the thresholds", () => {
  const rows = Model.volumeRows(G, settings({ warnAt: 30, criticalAt: 90 }));
  assert.equal(rows[1].level, "warning");
  assert.equal(rows[2].level, "normal");
});

test("driveBlocks pairs temperature and throughput per drive", () => {
  const blocks = Model.driveBlocks(G, settings({}));
  assert.deepEqual(blocks.map(b => b.model), ["Crucial_CT480M500SSD1", "Samsung SSD 960 PRO 512GB"]);
  assert.equal(blocks[0].temperatureText, "33 °C");
  assert.equal(blocks[1].temperatureText, "42 °C");
  assert.equal(blocks[1].rateText, "↓ 12M/s  ↑ 3.1M/s");
  assert.equal(blocks[1].device, "/dev/nvme0n1");
  assert.equal(blocks[1].showIo, true);
  assert.equal(blocks[1].failing, false);
});
test("driveBlocks honours showIo and showTemperature", () => {
  assert.deepEqual(Model.driveBlocks(G, settings({ showIo: false, showTemperature: false })), []);
  const tempsOnly = Model.driveBlocks(G, settings({ showIo: false }));
  assert.equal(tempsOnly[1].rateText, "");
  assert.equal(tempsOnly[1].showIo, false);
  const ioOnly = Model.driveBlocks(G, settings({ showTemperature: false }));
  assert.equal(ioOnly[1].temperatureText, "");
});
test("driveBlocks skips drives with nothing to show", () => {
  const bare = Model.applyEvent(Model.emptyState(), { event: "volumes",
    drives: [{ id: "unknown", model: "Unknown device", device: null, volumes: [] }] });
  assert.deepEqual(Model.driveBlocks(bare, settings({})), []);
});
test("driveBlocks flags failing drives and lists their warnings", () => {
  const failing = Model.applyEvent(G, { event: "health", drives: [{ drive_id: SAMSUNG, temperature_c: 70,
                                                                   failing: true, warnings: ["temperature", "spare"] }] });
  const b = Model.driveBlocks(failing, settings({}))[1];
  assert.equal(b.failing, true);
  assert.equal(b.warningText, "temperature, spare");
});

test("sparkline aligns samples to the right edge and scales to the peak", () => {
  const pts = Model.sparkline([{ read: 0, write: 50 }, { read: 100, write: 0 }], 290, 20);
  assert.equal(pts.read.length, 2);
  assert.equal(pts.read[0].x, 280);
  assert.equal(pts.read[1].x, 290);
  assert.equal(pts.read[1].y, 0);
  assert.equal(pts.read[0].y, 20);
  assert.equal(pts.write[0].y, 10);
});
test("sparkline of silence is a flat line along the bottom", () => {
  assert.equal(Model.sparkline([{ read: 0, write: 0 }], 100, 20).read[0].y, 20);
});
test("sparkline of nothing is empty", () => {
  assert.deepEqual(Model.sparkline([], 100, 20), { read: [], write: [] });
  assert.deepEqual(Model.sparkline(undefined, 100, 20), { read: [], write: [] });
});

test("stepCursor starts at an end and stays inside the list", () => {
  assert.equal(Model.stepCursor(-1, 1, 3), 0);
  assert.equal(Model.stepCursor(-1, -1, 3), 2);
  assert.equal(Model.stepCursor(0, -1, 3), 0);
  assert.equal(Model.stepCursor(2, 1, 3), 2);
  assert.equal(Model.stepCursor(1, 1, 3), 2);
  assert.equal(Model.stepCursor(1, 1, 0), -1);
});

test("shellQuote survives spaces and quotes", () => {
  assert.equal(Model.shellQuote("/mnt/My Disk"), "'/mnt/My Disk'");
  assert.equal(Model.shellQuote("/mnt/it's"), "'/mnt/it'\\''s'");
});

console.log("\n" + passed + " passed" + (process.exitCode ? ", some FAILED" : ""));
