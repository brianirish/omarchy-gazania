// Pure helpers for the Gazania bar widget. No QML imports, so the same file
// runs under Node for tests/model_test.js. The widget feeds every line of
// `gazania watch` through parseLine and applyEvent; everything the bar and the
// panel show is derived from the resulting state object.

var PROTOCOL = 1
var HISTORY = 30
// nf-md-harddisk (U+F02CA) as a surrogate pair, which both QML and Node read.
var GLYPH = "󰋊"
var UNITS = ["B", "K", "M", "G", "T", "P"]
var EVENTS = ["hello", "volumes", "io", "health", "error"]

function emptyState() {
  return { protocol: 0, drives: [], io: {}, history: {}, health: {}, lastError: "", hasVolumes: false }
}

function parseLine(text) {
  var line = String(text === undefined || text === null ? "" : text).trim()
  if (line === "") return null
  var event
  try {
    event = JSON.parse(line)
  } catch (e) {
    return null
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) return null
  return EVENTS.indexOf(event.event) >= 0 ? event : null
}

function copyOf(object) {
  var next = {}
  for (var key in object) next[key] = object[key]
  return next
}

// Returns a new state, or `state` itself when the event carries nothing usable.
function applyEvent(state, event) {
  if (!event) return state
  var next = copyOf(state)
  if (event.event === "hello") {
    next.protocol = Number(event.protocol) || 0
  } else if (event.event === "volumes") {
    if (!Array.isArray(event.drives)) return state
    next.drives = event.drives
    next.hasVolumes = true
    next.lastError = ""
  } else if (event.event === "io") {
    if (!Array.isArray(event.drives)) return state
    next.io = {}
    next.history = copyOf(state.history)
    for (var i = 0; i < event.drives.length; i++) {
      var rate = event.drives[i]
      if (!rate || typeof rate.device !== "string") continue
      var sample = {
        read: Math.max(0, Number(rate.read_bps) || 0),
        write: Math.max(0, Number(rate.write_bps) || 0)
      }
      next.io[rate.device] = sample
      next.history[rate.device] = (state.history[rate.device] || []).concat([sample]).slice(-HISTORY)
    }
  } else if (event.event === "health") {
    if (!Array.isArray(event.drives)) return state
    next.health = {}
    for (var j = 0; j < event.drives.length; j++) {
      var h = event.drives[j]
      if (h && typeof h.drive_id === "string") next.health[h.drive_id] = h
    }
  } else if (event.event === "error") {
    next.lastError = String(event.message || "")
  } else {
    return state
  }
  return next
}

// Same rules as gazania's human_size: 1024-based, one decimal below ten units.
function formatSize(bytes) {
  var n = Math.max(0, Number(bytes) || 0)
  if (n < 1024) return Math.floor(n) + "B"
  var unit = 0
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024
    unit++
  }
  return (n < 10 ? n.toFixed(1) : n.toFixed(0)) + UNITS[unit]
}

function formatRate(bps) {
  return formatSize(bps) + "/s"
}

var DEFAULTS = { barStat: "free", volume: "/", drive: "", warnAt: 85, criticalAt: 95, showIo: true, showTemperature: true }
var BAR_STATS = ["free", "io", "temperature", "none"]
var DASH = "—"

function numberOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback
  var n = Number(value)
  return isFinite(n) ? n : fallback
}

// Settings from shell.json, with every missing or invalid value replaced.
function withDefaults(partial) {
  var p = partial || {}
  return {
    barStat: BAR_STATS.indexOf(p.barStat) >= 0 ? p.barStat : DEFAULTS.barStat,
    volume: typeof p.volume === "string" && p.volume !== "" ? p.volume : DEFAULTS.volume,
    drive: typeof p.drive === "string" ? p.drive : DEFAULTS.drive,
    warnAt: numberOr(p.warnAt, DEFAULTS.warnAt),
    criticalAt: numberOr(p.criticalAt, DEFAULTS.criticalAt),
    showIo: p.showIo === undefined ? DEFAULTS.showIo : p.showIo === true,
    showTemperature: p.showTemperature === undefined ? DEFAULTS.showTemperature : p.showTemperature === true
  }
}

function findMount(state, path) {
  for (var i = 0; i < state.drives.length; i++) {
    var drive = state.drives[i]
    var volumes = drive.volumes || []
    for (var j = 0; j < volumes.length; j++) {
      var mounts = volumes[j].mount_points || []
      for (var k = 0; k < mounts.length; k++) {
        if (mounts[k].path === path) return { volume: volumes[j], drive: drive, mount: path }
      }
    }
  }
  return null
}

function firstMounted(state) {
  for (var i = 0; i < state.drives.length; i++) {
    var volumes = state.drives[i].volumes || []
    for (var j = 0; j < volumes.length; j++) {
      var mounts = volumes[j].mount_points || []
      if (volumes[j].usage && mounts.length > 0) {
        return { volume: volumes[j], drive: state.drives[i], mount: mounts[0].path }
      }
    }
  }
  return null
}

// The configured mount, else `/`, else the first mounted volume. `fallback`
// says whether the configured mount was found.
function trackedVolume(state, settings) {
  var exact = findMount(state, settings.volume)
  if (exact) {
    exact.fallback = false
    return exact
  }
  var other = (settings.volume !== "/" ? findMount(state, "/") : null) || firstMounted(state)
  if (other) other.fallback = true
  return other
}

function trackedDrive(state, settings) {
  if (settings.drive !== "") {
    for (var i = 0; i < state.drives.length; i++) {
      if (state.drives[i].device === settings.drive) return state.drives[i]
    }
    return null
  }
  var tracked = trackedVolume(state, settings)
  return tracked ? tracked.drive : null
}

// Used over used plus available, rounded up, the way df reports it.
function usedPercent(volume) {
  if (!volume || !volume.usage) return null
  var used = Number(volume.usage.used) || 0
  var total = used + (Number(volume.usage.available) || 0)
  if (total <= 0) return 0
  return Math.ceil(used / total * 100)
}

function level(percent, settings) {
  if (percent === null || percent === undefined) return "normal"
  if (percent >= settings.criticalAt) return "error"
  if (percent >= settings.warnAt) return "warning"
  return "normal"
}

function temperatureOf(state, drive) {
  if (!drive) return null
  var h = state.health[drive.id]
  if (!h || h.temperature_c === null || h.temperature_c === undefined) return null
  var t = Number(h.temperature_c)
  return isFinite(t) ? t : null
}

function barText(state, settings, vertical) {
  if (vertical || settings.barStat === "none") return GLYPH
  if (settings.barStat === "free") {
    var tracked = trackedVolume(state, settings)
    var used = tracked ? usedPercent(tracked.volume) : null
    return GLYPH + " " + (used === null ? DASH : (100 - used) + "%")
  }
  if (settings.barStat === "io") {
    var drive = trackedDrive(state, settings)
    var rate = drive && drive.device ? state.io[drive.device] : null
    if (!rate) return GLYPH + " " + DASH
    return GLYPH + " ↓" + formatSize(rate.read) + " ↑" + formatSize(rate.write)
  }
  var t = temperatureOf(state, trackedDrive(state, settings))
  return GLYPH + " " + (t === null ? DASH : Math.round(t) + "°")
}

function barLevel(state, settings) {
  if (settings.barStat === "temperature") {
    var drive = trackedDrive(state, settings)
    var h = drive ? state.health[drive.id] : null
    return h && h.failing ? "error" : "normal"
  }
  var tracked = trackedVolume(state, settings)
  return level(tracked ? usedPercent(tracked.volume) : null, settings)
}

// Bar slot width in icon slots for the stat text.
function slotWidth(settings, vertical) {
  if (vertical || settings.barStat === "none") return 1
  return settings.barStat === "io" ? 4 : 2
}

function tooltip(state, settings, status) {
  if (status === "missing") return "Install the gazania package (0.2 or newer)"
  if (status === "outdated") return "Update gazania to 0.2 or newer"
  if (!state.hasVolumes) return state.lastError !== "" ? "Gazania: " + state.lastError : "Gazania: connecting…"
  var tracked = trackedVolume(state, settings)
  if (!tracked) return "No mounted volumes"
  var lines = [tracked.mount]
  var usage = tracked.volume.usage
  if (usage) {
    lines.push(formatSize(usage.used) + " of " + formatSize(tracked.volume.size) + " used")
    lines.push(formatSize(usage.available) + " free")
  }
  if (tracked.fallback) lines.push(settings.volume + " not found, showing " + tracked.mount)
  if (state.lastError !== "") lines.push(state.lastError)
  return lines.join("\n")
}

// What to do when `gazania watch` exits. 127: not installed, recheck every
// minute. 2 before any hello: clap rejected `watch`, so gazania predates 0.2.
// Anything else: restart with backoff doubling from 2 s to 30 s.
function exitDecision(code, sawHello, status, backoffMs) {
  if (status === "outdated") return { status: "outdated", retryMs: 0, nextBackoffMs: backoffMs }
  if (code === 127) return { status: "missing", retryMs: 60000, nextBackoffMs: 2000 }
  if (code === 2 && !sawHello) return { status: "outdated", retryMs: 0, nextBackoffMs: backoffMs }
  return { status: "connecting", retryMs: backoffMs, nextBackoffMs: Math.min(backoffMs * 2, 30000) }
}

// nf-md-alert (U+F0026) as a surrogate pair.
var ALERT = "󰀦"

function heroSubtitle(state, settings, status) {
  if (status === "missing") return "gazania is not installed"
  if (status === "outdated") return "gazania needs an update"
  var tracked = trackedVolume(state, settings)
  if (!tracked || !tracked.volume.usage) return state.hasVolumes ? "no mounted volumes" : "connecting"
  return formatSize(tracked.volume.usage.available) + " free on " + tracked.mount
}

function volumeLabel(volume) {
  return volume.label ? String(volume.label) : String(volume.device || "")
}

// One row per volume, in stream order; `firstOfDrive` marks where a drive's
// section header goes.
function volumeRows(state, settings) {
  var rows = []
  for (var i = 0; i < state.drives.length; i++) {
    var drive = state.drives[i]
    var volumes = drive.volumes || []
    for (var j = 0; j < volumes.length; j++) {
      var v = volumes[j]
      var mounts = (v.mount_points || []).map(function(m) { return m.path })
      var percent = usedPercent(v)
      rows.push({
        key: String(v.id),
        firstOfDrive: j === 0,
        driveModel: String(drive.model || ""),
        label: volumeLabel(v),
        mounts: mounts.length > 0 ? mounts.join(", ") : "Not mounted",
        mount: mounts.length > 0 ? mounts[0] : "",
        sizeText: v.usage ? formatSize(v.usage.used) + " of " + formatSize(v.size) : formatSize(v.size),
        freeText: v.usage ? formatSize(v.usage.available) + " free" : "",
        fraction: percent === null ? 0 : percent / 100,
        level: level(percent, settings)
      })
    }
  }
  return rows
}

// One block per drive with something to show: temperature, throughput or both.
function driveBlocks(state, settings) {
  if (!settings.showIo && !settings.showTemperature) return []
  var blocks = []
  for (var i = 0; i < state.drives.length; i++) {
    var drive = state.drives[i]
    var h = state.health[drive.id] || null
    var t = temperatureOf(state, drive)
    var rate = drive.device ? state.io[drive.device] : null
    var block = {
      key: String(drive.id),
      model: String(drive.model || ""),
      device: drive.device ? String(drive.device) : "",
      temperatureText: settings.showTemperature && t !== null ? Math.round(t) + " °C" : "",
      failing: !!(h && h.failing),
      warningText: h && h.warnings && h.warnings.length ? h.warnings.join(", ") : "",
      rateText: settings.showIo && rate
        ? "↓ " + formatRate(rate.read) + "  ↑ " + formatRate(rate.write)
        : "",
      showIo: settings.showIo && !!drive.device
    }
    if (block.temperatureText === "" && !block.showIo && !block.failing) continue
    blocks.push(block)
  }
  return blocks
}

// Points for a read line and a write line, right-aligned across HISTORY slots
// and scaled to the larger peak of the two; silence lies along the bottom.
function sparkline(samples, width, height) {
  var list = (samples || []).slice(-HISTORY)
  var max = 0
  for (var i = 0; i < list.length; i++) max = Math.max(max, list[i].read, list[i].write)
  var step = width / (HISTORY - 1)
  var offset = HISTORY - list.length
  var y = function(v) { return max > 0 ? height - (v / max) * height : height }
  var read = []
  var write = []
  for (var j = 0; j < list.length; j++) {
    var x = (offset + j) * step
    read.push({ x: x, y: y(list[j].read) })
    write.push({ x: x, y: y(list[j].write) })
  }
  return { read: read, write: write }
}

// Keyboard cursor over `length` rows; -1 means no row yet.
function stepCursor(index, delta, length) {
  if (length <= 0) return -1
  if (index < 0) return delta > 0 ? 0 : length - 1
  return Math.max(0, Math.min(length - 1, index + delta))
}

// Single-quote for `sh -c`, which is how the bar runs commands.
function shellQuote(text) {
  return "'" + String(text).replace(/'/g, "'\\''") + "'"
}

if (typeof module !== "undefined") {
  module.exports = {
    PROTOCOL: PROTOCOL,
    HISTORY: HISTORY,
    GLYPH: GLYPH,
    DEFAULTS: DEFAULTS,
    emptyState: emptyState,
    parseLine: parseLine,
    applyEvent: applyEvent,
    formatSize: formatSize,
    formatRate: formatRate,
    withDefaults: withDefaults,
    trackedVolume: trackedVolume,
    trackedDrive: trackedDrive,
    usedPercent: usedPercent,
    level: level,
    temperatureOf: temperatureOf,
    barText: barText,
    barLevel: barLevel,
    slotWidth: slotWidth,
    tooltip: tooltip,
    exitDecision: exitDecision,
    ALERT: ALERT,
    heroSubtitle: heroSubtitle,
    volumeRows: volumeRows,
    driveBlocks: driveBlocks,
    sparkline: sparkline,
    stepCursor: stepCursor,
    shellQuote: shellQuote
  }
}
