// Unit tests for Model.js (the widget's pure helpers). Run with: node tests/model_test.js
// Model.js is a QML JavaScript library; it exports through `module.exports`
// only when loaded by Node, so it can be required directly here.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Model = require(path.join(__dirname, "..", "Model.js"));
const { tr } = require(path.join(__dirname, "tr.js"));
const en = tr("en");
// The shell's I18n.formatNumber for a language with a decimal comma (Danish).
const comma = (v, d) => (d === undefined ? String(v) : Number(v).toFixed(d)).replace(".", ",");
// …and for one with its own digits (Bengali).
const bengali = (v, d) => (d === undefined ? String(v) : Number(v).toFixed(d)).replace(/[0-9]/g, (c) => "০১২৩৪৫৬৭৮৯"[c]);

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
test("formatSize takes the language's decimal separator and digits, never its units", () => {
  assert.equal(Model.formatSize(1536, comma), "1,5K");
  assert.equal(Model.formatSize(3250585, comma), "3,1M");
  assert.equal(Model.formatSize(12582912, comma), "12M");
  assert.equal(Model.formatSize(512, comma), "512B");
  assert.equal(Model.formatSize(1536, bengali), "১.৫K");
  assert.equal(Model.formatRate(3250585, comma), "3,1M/s");
});

// fill
test("fill replaces numbered placeholders, in any order", () => {
  assert.equal(Model.fill("%2 then %1", ["a", "b"]), "b then a");
});
test("fill reads %%1 as a percent sign before the value, as Turkish writes it", () => {
  assert.equal(Model.fill("%%1", [65]), "%65");
});
test("fill leaves a placeholder without a value alone", () => {
  assert.equal(Model.fill("%1 %2", ["a"]), "a %2");
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
                                 showIo: false, showTemperature: true });
  assert.equal(s.barStat, "free");
  assert.equal(s.volume, "/");
  assert.equal(s.warnAt, 90);
  assert.equal(s.criticalAt, 95);
  assert.equal(s.showIo, false);
  assert.equal(s.showTemperature, true);
});

test("withDefaults swaps an inverted warnAt and criticalAt pair", () => {
  // Issue #4: an inverted pair put the error color below the warning threshold.
  const s = Model.withDefaults({ warnAt: 95, criticalAt: 80 });
  assert.equal(s.warnAt, 80);
  assert.equal(s.criticalAt, 95);
  const one = Model.withDefaults({ warnAt: "97" });
  assert.deepEqual([one.warnAt, one.criticalAt], [95, 97]);
  assert.equal(Model.level(85, s), "warning");
  const equal = Model.withDefaults({ warnAt: 90, criticalAt: 90 });
  assert.deepEqual([equal.warnAt, equal.criticalAt], [90, 90]);
});

test("withDefaults reads string booleans the way omarchy bar set stores them", () => {
  const io = (v) => Model.withDefaults({ showIo: v }).showIo;
  for (const v of ["true", "1", "yes", "on", " TRUE ", true]) assert.equal(io(v), true, String(v));
  for (const v of ["false", "0", "no", "off", false]) assert.equal(io(v), false, String(v));
  assert.equal(io("maybe"), true);
  assert.equal(io(undefined), true);
  assert.equal(Model.withDefaults({ showTemperature: "off" }).showTemperature, false);
  assert.equal(Model.withDefaults({ showTemperature: "nonsense" }).showTemperature, true);
  assert.equal(Model.withDefaults({ warnAt: "90", criticalAt: "99" }).criticalAt, 99);
});

test("hostile null entries in drives, volumes and mount points do not throw", () => {
  const s = Model.applyEvent(Model.emptyState(), { event: "volumes", drives: [
    null, 7, { id: "d", model: "M", device: "/dev/x", volumes: [
      null, { id: "v", size: 100, usage: { used: 1, available: 9 }, mount_points: [null, { path: "/" }, "x"] }] }] });
  assert.equal(s.drives.length, 1);
  assert.equal(s.drives[0].volumes.length, 1);
  assert.equal(s.drives[0].volumes[0].mount_points.length, 1);
  const cfg = settings({});
  assert.equal(Model.volumeRows(s, cfg, en).length, 1);
  Model.driveBlocks(s, cfg);
  assert.ok(Model.barLabel(s, cfg, false, en).length > 0);
  assert.ok(Model.tooltip(s, cfg, "ok", en).length > 0);
});

test("non-array warnings and non-finite numbers never reach the display", () => {
  let s = Model.applyEvent(Model.emptyState(), { event: "volumes", drives: [{ id: "d", device: "/dev/x", model: "M", volumes: [] }] });
  s = Model.applyEvent(s, { event: "health", drives: [{ drive_id: "d", warnings: "oops", temperature_c: 30 }] });
  assert.equal(Model.driveBlocks(s, settings({}))[0].warningText, "");
  s = Model.applyEvent(s, JSON.parse('{"event":"io","drives":[{"device":"/dev/x","read_bps":9e999,"write_bps":1}]}'));
  assert.equal(s.io["/dev/x"].read, 0);
  assert.equal(Model.formatSize(JSON.parse("9e999")), "0B");
  assert.equal(Model.formatSize(Infinity), "0B");
  assert.equal(Model.formatRate(NaN), "0B/s");
  assert.ok(!Model.driveBlocks(s, settings({}))[0].rateText.includes("Infinity"));
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

test("barIcon is the disk glyph", () => {
  assert.equal(Model.barIcon(), GLYPH);
});
test("barLabel free shows the free percent of the tracked volume", () => {
  assert.equal(Model.barLabel(G, settings({}), false, en), "65%");
});
test("barLabel io shows read and write per second", () => {
  assert.equal(Model.barLabel(G, settings({ barStat: "io" }), false, en), "↓12M ↑3.1M");
});
test("barLabel io without a rate shows a dash", () => {
  assert.equal(Model.barLabel(G, settings({ barStat: "io", drive: "/dev/sdz" }), false, en), "—");
  const noIo = Model.applyEvent(G, { event: "io", drives: [] });
  assert.equal(Model.barLabel(noIo, settings({ barStat: "io" }), false, en), "—");
});
test("barLabel temperature rounds to whole degrees", () => {
  assert.equal(Model.barLabel(G, settings({ barStat: "temperature" }), false, en), "42°");
});
test("barLabel temperature without data shows a dash", () => {
  const noTemp = Model.applyEvent(G, { event: "health", drives: [{ drive_id: SAMSUNG, temperature_c: null,
                                                                  failing: false, warnings: [] }] });
  assert.equal(Model.barLabel(noTemp, settings({ barStat: "temperature" }), false, en), "—");
});
test("barLabel is empty for none and vertical bars, and a dash without data", () => {
  assert.equal(Model.barLabel(G, settings({ barStat: "none" }), false, en), "");
  assert.equal(Model.barLabel(G, settings({}), true, en), "");
  assert.equal(Model.barLabel(Model.emptyState(), settings({}), false, en), "—");
});
test("barLabel numbers follow the language, units and signs stay", () => {
  const busy = Model.applyEvent(G, { event: "io", drives: [{ device: "/dev/nvme0n1", read_bps: 1288490189, write_bps: 3250585 }] });
  assert.equal(Model.barLabel(busy, settings({ barStat: "io" }), false, en, comma), "↓1,2G ↑3,1M");
  assert.equal(Model.barLabel(G, settings({}), false, en, bengali), "৬৫%");
  assert.equal(Model.barLabel(G, settings({ barStat: "temperature" }), false, en, bengali), "৪২°");
});
test("barLabel free percent follows the catalog's placement of the sign", () => {
  const turkish = { t: (key) => (key === "bar.freePercent" ? "%%1" : en.t(key)), tn: en.tn };
  assert.equal(Model.barLabel(G, settings({}), false, turkish), "%65");
});
test("showsLabel needs a stat and a horizontal bar", () => {
  assert.equal(Model.showsLabel(settings({}), false), true);
  assert.equal(Model.showsLabel(settings({ barStat: "io" }), false), true);
  assert.equal(Model.showsLabel(settings({ barStat: "none" }), false), false);
  assert.equal(Model.showsLabel(settings({}), true), false);
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

test("slotWidth gives one slot to the bare glyph", () => {
  assert.equal(Model.slotWidth(settings({ barStat: "none" }), false), 1);
  assert.equal(Model.slotWidth(settings({ barStat: "io" }), true), 1);
  assert.equal(Model.slotWidth(settings({}), true), 1);
});
// BarIconButton lays out the label at Style.bar.iconFont (13 px), a
// Style.space(4) gap and the Style.bar.iconCanvas (16 px) icon, centered in
// slotSize = Style.bar.iconSlot (27 px) * slotWidth. The bar font is
// monospaced at 0.6 em, 7.8 px a character, rounded up to 8 for hinting.
test("slotWidth fits the widest label each stat can show", () => {
  const fits = (label, stat) => {
    const content = 16 + 4 + [...label].length * 8;
    const slot = 27 * Model.slotWidth(settings({ barStat: stat }), false);
    assert.ok(content <= slot, label + " needs " + content + " px, " + stat + " has " + slot);
  };
  const empty = Model.applyEvent(G, { event: "volumes", drives: [{ id: "d", model: "M", device: "/dev/x", volumes: [
    { id: "v", device: "/dev/x1", size: 10, usage: { used: 0, available: 10 }, mount_points: [{ path: "/" }] }] }] });
  fits(Model.barLabel(empty, settings({}), false, en), "free");
  assert.equal(Model.barLabel(empty, settings({}), false, en), "100%");
  const hot = Model.applyEvent(G, { event: "health", drives: [{ drive_id: SAMSUNG, temperature_c: 100, failing: false, warnings: [] }] });
  fits(Model.barLabel(hot, settings({ barStat: "temperature" }), false, en), "temperature");
  // Just under a unit boundary, gazania's rounding writes four digits.
  const widest = Model.applyEvent(G, { event: "io", drives: [{ device: "/dev/nvme0n1", read_bps: 1048575, write_bps: 1048000 }] });
  assert.equal(Model.barLabel(widest, settings({ barStat: "io" }), false, en), "↓1024K ↑1023K");
  fits(Model.barLabel(widest, settings({ barStat: "io" }), false, en, comma), "io");
  fits("↓9,9M ↑9,9M", "io");
});

test("tooltip explains a missing or outdated gazania", () => {
  assert.equal(Model.tooltip(G, settings({}), "missing", en), "Install the gazania package (0.2 or newer)");
  assert.equal(Model.tooltip(G, settings({}), "outdated", en), "Update gazania to 0.2 or newer");
});
// Issue #1: a hello with a newer protocol means the widget is the old side.
const newerHello = Model.applyEvent(s0, { event: "hello", protocol: Model.PROTOCOL + 1, version: "9.0.0" });
const olderHello = Model.applyEvent(s0, { event: "hello", protocol: 0, version: "0.1.9" });
test("tooltip asks to update the bar plugin when gazania speaks a newer protocol", () => {
  assert.equal(Model.tooltip(newerHello, settings({}), "outdated", en), "Update the Gazania bar plugin to work with this newer gazania");
  assert.equal(Model.tooltip(olderHello, settings({}), "outdated", en), "Update gazania to 0.2 or newer");
});
test("pluginOutdated needs the outdated status and a protocol newer than the widget's", () => {
  assert.equal(Model.pluginOutdated(newerHello, "outdated"), true);
  assert.equal(Model.pluginOutdated(newerHello, "ok"), false);
  assert.equal(Model.pluginOutdated(olderHello, "outdated"), false);
  assert.equal(Model.pluginOutdated(s0, "outdated"), false);
});
test("tooltip says connecting before the first volumes event", () => {
  assert.equal(Model.tooltip(Model.emptyState(), settings({}), "connecting", en), "Gazania: connecting…");
});
test("tooltip shows a stream error before the first volumes event", () => {
  const err = Model.applyEvent(Model.emptyState(), { event: "error", message: "udisks2 is not running" });
  assert.equal(Model.tooltip(err, settings({}), "connecting", en), "Gazania: udisks2 is not running");
});
test("tooltip shows the tracked volume's usage", () => {
  assert.equal(Model.tooltip(G, settings({}), "ok", en), "/\n164G of 475G used\n311G free");
});
test("tooltip sizes follow the language's decimal separator", () => {
  assert.equal(Model.tooltip(G, settings({ volume: "/boot" }), "ok", en, comma), "/boot\n219M of 2,0G used\n1,8G free");
});
test("tooltip names a configured mount that was not found", () => {
  assert.match(Model.tooltip(G, settings({ volume: "/mnt/usb" }), "ok", en), /\/mnt\/usb not found, showing \//);
});
test("tooltip carries the last stream error", () => {
  const err = Model.applyEvent(G, { event: "error", message: "udisks2 connection lost" });
  assert.match(Model.tooltip(err, settings({}), "ok", en), /udisks2 connection lost$/);
});
test("tooltip keeps markup-shaped paths and errors verbatim, for a plain-text sink", () => {
  const sneaky = '<img src="https://example.invalid/t">';
  assert.ok(Model.tooltip(G, settings({ volume: sneaky }), "ok", en).endsWith("\n" + sneaky + " not found, showing /"));
  const err = Model.applyEvent(G, { event: "error", message: sneaky });
  assert.ok(Model.tooltip(err, settings({}), "ok", en).endsWith("\n" + sneaky));
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
test("exitDecision: a watcher that never started rechecks every minute", () => {
  // Issue #2: setpriv itself failing to start sends no exit code.
  assert.deepEqual(Model.exitDecision(null, false, "connecting", 8000), { status: "unstartable", retryMs: 60000, nextBackoffMs: 2000 });
  assert.notEqual(Model.exitDecision(0, false, "connecting", 2000).status, "unstartable");
});
test("tooltip and heroSubtitle explain a watcher that could not start", () => {
  assert.match(Model.tooltip(G, settings({}), "unstartable", en), /^Could not start setpriv/);
  assert.equal(Model.heroSubtitle(G, settings({}), "unstartable", en), "SETPRIV COULD NOT START");
});
test("exitDecision: an outdated stream stays stopped", () => {
  assert.deepEqual(Model.exitDecision(143, true, "outdated", 2000), { status: "outdated", retryMs: 0, nextBackoffMs: 2000 });
});

// ---------- panel view models ----------
test("heroSubtitle reports free space on the tracked volume, in capitals", () => {
  assert.equal(Model.heroSubtitle(G, settings({}), "ok", en), "311G FREE ON /");
  assert.equal(Model.heroSubtitle(G, settings({ volume: "/boot" }), "ok", en, comma), "1,8G FREE ON /boot");
});
test("heroSubtitle capitalises its own words but never the mount point", () => {
  const media = Model.applyEvent(Model.emptyState(), { event: "volumes", drives: [{ id: "d", model: "M", device: "/dev/sdb",
    volumes: [{ id: "v", device: "/dev/sdb1", size: 10, usage: { used: 1, available: 9 },
                mount_points: [{ path: "/run/media/me/My Stick" }] }] }] });
  assert.equal(Model.heroSubtitle(media, settings({ volume: "/run/media/me/My Stick" }), "ok", en),
    "9B FREE ON /run/media/me/My Stick");
});
test("heroSubtitle explains missing data", () => {
  assert.equal(Model.heroSubtitle(Model.emptyState(), settings({}), "connecting", en), "CONNECTING");
  assert.equal(Model.heroSubtitle(Model.applyEvent(Model.emptyState(), { event: "volumes", drives: [] }), settings({}), "ok", en),
    "NO MOUNTED VOLUMES");
  assert.equal(Model.heroSubtitle(G, settings({}), "missing", en), "GAZANIA IS NOT INSTALLED");
  assert.equal(Model.heroSubtitle(G, settings({}), "outdated", en), "GAZANIA NEEDS AN UPDATE");
});
test("heroSubtitle names the side that needs an update", () => {
  assert.equal(Model.heroSubtitle(newerHello, settings({}), "outdated", en), "THE BAR PLUGIN NEEDS AN UPDATE");
  assert.equal(Model.heroSubtitle(olderHello, settings({}), "outdated", en), "GAZANIA NEEDS AN UPDATE");
});

test("volumeRows lists every volume grouped by drive, in stream order", () => {
  const rows = Model.volumeRows(G, settings({}), en);
  assert.deepEqual(rows.map(r => r.label), ["SSD_480GB", "/dev/mapper/root", "/dev/nvme0n1p1"]);
  assert.deepEqual(rows.map(r => r.firstOfDrive), [true, true, false]);
  assert.deepEqual(rows.map(r => r.driveModel),
    ["Crucial_CT480M500SSD1", "Samsung SSD 960 PRO 512GB", "Samsung SSD 960 PRO 512GB"]);
});
test("volumeRows describes mounted and unmounted volumes", () => {
  const [ntfs, root, boot] = Model.volumeRows(G, settings({}), en);
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
test("volumeRows shows a dash for a size udisks2 does not report", () => {
  // Issue #4: gazania sends size 0 when udisks2 has none; that is not "0B".
  const unsized = Model.applyEvent(Model.emptyState(), { event: "volumes", drives: [{ id: "d", model: "Card reader", device: "/dev/sdd",
    volumes: [{ id: "v0", device: "/dev/sdd1", size: 0, usage: null, mount_points: [] },
              { id: "v1", device: "/dev/sdd2", size: null, usage: null, mount_points: [] },
              { id: "v2", device: "/dev/sdd3", usage: null, mount_points: [] },
              { id: "v3", device: "/dev/sdd4", size: 0, usage: { used: 1024, available: 0 }, mount_points: [{ path: "/mnt/x" }] }] }] });
  const rows = Model.volumeRows(unsized, settings({}), en);
  assert.deepEqual(rows.map((r) => r.sizeText), ["—", "—", "—", "1.0K of —"]);
  assert.equal(Model.volumeSize({ size: 1536 }), "1.5K");
  assert.equal(Model.volumeSize({ size: "x" }), "—");
  assert.equal(Model.volumeSize(null), "—");
});
test("volumeRows sizes follow the language's decimal separator", () => {
  const boot = Model.volumeRows(G, settings({}), en, comma)[2];
  assert.equal(boot.sizeText, "219M of 2,0G");
  assert.equal(boot.freeText, "1,8G free");
});
test("volumeRows levels follow the thresholds", () => {
  const rows = Model.volumeRows(G, settings({ warnAt: 30, criticalAt: 90 }), en);
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
test("driveBlocks numbers follow the language, units stay", () => {
  const blocks = Model.driveBlocks(G, settings({}), comma);
  assert.equal(blocks[1].temperatureText, "42 °C");
  assert.equal(blocks[1].rateText, "↓ 12M/s  ↑ 3,1M/s");
  assert.equal(Model.driveBlocks(G, settings({}), bengali)[1].temperatureText, "৪২ °C");
});
test("driveBlocks keeps model names verbatim", () => {
  const odd = Model.applyEvent(G, { event: "volumes", drives: [{ id: "d", model: "<b>WD</b> & co", device: "/dev/sdc", volumes: [] }] });
  assert.equal(Model.driveBlocks(odd, settings({}))[0].model, "<b>WD</b> & co");
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
test("sparkline mirrored puts the newest sample at the left edge", () => {
  const pts = Model.sparkline([{ read: 0, write: 50 }, { read: 100, write: 0 }], 290, 20, true);
  assert.equal(pts.read[0].x, 10);
  assert.equal(pts.read[1].x, 0);
  assert.equal(pts.read[1].y, 0);
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

// scrollToShow: the panel keeps the keyboard highlight in view (issue #3).
test("scrollToShow leaves a row that is already in view alone", () => {
  assert.equal(Model.scrollToShow(100, 140, 50, 400, 1000, 6), 50);
});
test("scrollToShow scrolls down just far enough to show a row below the view", () => {
  assert.equal(Model.scrollToShow(500, 540, 50, 400, 1000, 6), 146);
});
test("scrollToShow scrolls up to show a row above the view, with the margin", () => {
  assert.equal(Model.scrollToShow(100, 140, 300, 400, 1000, 6), 94);
});
test("scrollToShow stays inside the content", () => {
  assert.equal(Model.scrollToShow(2, 40, 300, 400, 1000, 6), 0);
  assert.equal(Model.scrollToShow(960, 1000, 0, 400, 1000, 6), 600);
  assert.equal(Model.scrollToShow(100, 140, 0, 400, 300, 6), 0);
});
test("scrollToShow shows the top of a row taller than the view", () => {
  assert.equal(Model.scrollToShow(500, 1000, 0, 400, 2000, 6), 494);
});

test("shellQuote survives spaces and quotes", () => {
  assert.equal(Model.shellQuote("/mnt/My Disk"), "'/mnt/My Disk'");
  assert.equal(Model.shellQuote("/mnt/it's"), "'/mnt/it'\\''s'");
  assert.equal(Model.shellQuote("$(id)"), "'$(id)'");
  assert.equal(Model.shellQuote("a`id`b"), "'a`id`b'");
  assert.equal(Model.shellQuote('a"b'), "'a\"b'");
});

console.log("\n" + passed + " passed" + (process.exitCode ? ", some FAILED" : ""));
