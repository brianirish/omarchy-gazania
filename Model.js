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

if (typeof module !== "undefined") {
  module.exports = {
    PROTOCOL: PROTOCOL,
    HISTORY: HISTORY,
    GLYPH: GLYPH,
    emptyState: emptyState,
    parseLine: parseLine,
    applyEvent: applyEvent,
    formatSize: formatSize,
    formatRate: formatRate
  }
}
