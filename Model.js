// Pure helpers for the Gazania bar widget. No QML imports, so the same file
// runs under Node for tests/model_test.js. The widget feeds every line of
// `gazania watch` through parseLine and applyEvent; everything the bar and the
// panel show is derived from the resulting state object.
//
// Text comes from the i18n/ catalogs through `tr`, anything with t(key) and
// tn(key, count): the widget's Commons.Translations in the shell, the
// tests/tr.js stand-in under Node. Numbers come through `formatNumber(value,
// decimals)` (Commons.I18n.formatNumber in the shell), so sizes take the
// language's decimal separator and digits; without it they are written the
// plain JavaScript way. Unit letters and the degree sign stay as they are, and
// names, paths and messages from gazania are data, passed through verbatim.

var PROTOCOL = 1
var HISTORY = 30
// nf-md-harddisk (U+F02CA) as a surrogate pair, which both QML and Node read.
var GLYPH = "󰋊"
var UNITS = ["B", "K", "M", "G", "T", "P"]
var EVENTS = ["hello", "volumes", "io", "health", "error"]

// Fills %1, %2, … from values, the way QML's String.arg() does; Node has no
// arg(). Only %<digit> is a placeholder, so "%%1" in a Turkish catalog
// reads "%65".
function fill(template, values) {
  return String(template).replace(/%(\d)/g, function(match, n) {
    var value = values[Number(n) - 1]
    return value === undefined ? match : String(value)
  })
}

// `value` written with `decimals` places (or as it is when undefined), by
// the language's rules when the shell passes formatNumber.
function number(value, decimals, formatNumber) {
  if (formatNumber) return formatNumber(value, decimals)
  return decimals === undefined ? String(value) : Number(value).toFixed(decimals)
}

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

// A finite number, or 0 for anything missing, non-numeric, NaN or infinite.
function finiteOr0(value) {
  var n = Number(value)
  return isFinite(n) ? n : 0
}

function objectsOnly(list) {
  return (Array.isArray(list) ? list : []).filter(function(item) {
    return item !== null && typeof item === "object" && !Array.isArray(item)
  })
}

// Drops null and non-object entries at every level the panel walks.
function cleanDrives(drives) {
  return objectsOnly(drives).map(function(drive) {
    var clean = copyOf(drive)
    if (drive.volumes !== undefined) {
      clean.volumes = objectsOnly(drive.volumes).map(function(volume) {
        var v = copyOf(volume)
        if (volume.mount_points !== undefined) v.mount_points = objectsOnly(volume.mount_points)
        return v
      })
    }
    return clean
  })
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
    next.drives = cleanDrives(event.drives)
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
        read: Math.max(0, finiteOr0(rate.read_bps)),
        write: Math.max(0, finiteOr0(rate.write_bps))
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
// The unit letters stay as they are in every language; the number takes the
// language's decimal separator ("1,5K" in Danish).
function formatSize(bytes, formatNumber) {
  var n = Math.max(0, finiteOr0(bytes))
  if (n < 1024) return number(Math.floor(n), 0, formatNumber) + "B"
  var unit = 0
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024
    unit++
  }
  return number(n, n < 10 ? 1 : 0, formatNumber) + UNITS[unit]
}

function formatRate(bps, formatNumber) {
  return formatSize(bps, formatNumber) + "/s"
}

var DEFAULTS = { barStat: "free", volume: "/", drive: "", warnAt: 85, criticalAt: 95, showIo: true, showTemperature: true }
var BAR_STATS = ["free", "io", "temperature", "none"]
var DASH = "—"

function numberOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback
  var n = Number(value)
  return isFinite(n) ? n : fallback
}

// `omarchy bar set` stores strings unless given --json, so "true" and "off"
// must work; the tokens match Style.boolToken in the shell.
function boolSetting(value, fallback) {
  if (value === true || value === false) return value
  var t = String(value).trim().toLowerCase()
  if (t === "true" || t === "1" || t === "yes" || t === "on") return true
  if (t === "false" || t === "0" || t === "no" || t === "off") return false
  return fallback
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
    showIo: boolSetting(p.showIo, DEFAULTS.showIo),
    showTemperature: boolSetting(p.showTemperature, DEFAULTS.showTemperature)
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
  var used = finiteOr0(volume.usage.used)
  var total = used + finiteOr0(volume.usage.available)
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

// The bar draws the disk glyph as its icon and, on a horizontal bar, the
// stat as a label before it ("65% 󰋊"), the way the built-in battery does.
// Omarchy 4.5 fits a BarIconButton's text into one icon box, so the two
// must not share a string.
function barIcon() {
  return GLYPH
}

function showsLabel(settings, vertical) {
  return !vertical && settings.barStat !== "none"
}

function barLabel(state, settings, vertical, tr, formatNumber) {
  if (!showsLabel(settings, vertical)) return ""
  if (settings.barStat === "free") {
    var tracked = trackedVolume(state, settings)
    var used = tracked ? usedPercent(tracked.volume) : null
    return used === null ? DASH : fill(tr.t("bar.freePercent"), [number(100 - used, 0, formatNumber)])
  }
  if (settings.barStat === "io") {
    var drive = trackedDrive(state, settings)
    var rate = drive && drive.device ? state.io[drive.device] : null
    if (!rate) return DASH
    return "↓" + formatSize(rate.read, formatNumber) + " ↑" + formatSize(rate.write, formatNumber)
  }
  var t = temperatureOf(state, trackedDrive(state, settings))
  return t === null ? DASH : number(Math.round(t), 0, formatNumber) + "°"
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

// Bar slot width in icon slots. The label is drawn at the bar's icon font
// (13 px) before the 16 px icon canvas and a 4 px gap, so each stat gets
// room for the widest label it can show: "100%" and "100°" in two slots,
// and "↓1023K ↑1023K" in five.
function slotWidth(settings, vertical) {
  if (!showsLabel(settings, vertical)) return 1
  return settings.barStat === "io" ? 5 : 2
}

// "outdated" covers two cases. gazania older than 0.2 rejects `watch`
// before saying hello, so no protocol is recorded; that gazania needs an
// update. A hello naming a newer protocol than PROTOCOL means gazania is
// ahead of this widget, and the bar plugin is the one to update.
function pluginOutdated(state, status) {
  return status === "outdated" && Number(state.protocol) > PROTOCOL
}

function tooltip(state, settings, status, tr, formatNumber) {
  if (status === "missing") return tr.t("tooltip.missing")
  if (status === "unstartable") return tr.t("tooltip.unstartable")
  if (pluginOutdated(state, status)) return tr.t("tooltip.pluginOutdated")
  if (status === "outdated") return tr.t("tooltip.gazaniaOutdated")
  if (!state.hasVolumes) return state.lastError !== "" ? fill(tr.t("tooltip.error"), [state.lastError]) : tr.t("tooltip.connecting")
  var tracked = trackedVolume(state, settings)
  if (!tracked) return tr.t("tooltip.noVolumes")
  var lines = [tracked.mount]
  var usage = tracked.volume.usage
  if (usage) {
    lines.push(fill(tr.t("tooltip.usedOfSize"), [formatSize(usage.used, formatNumber), formatSize(tracked.volume.size, formatNumber)]))
    lines.push(fill(tr.t("space.free"), [formatSize(usage.available, formatNumber)]))
  }
  if (tracked.fallback) lines.push(fill(tr.t("tooltip.fallback"), [settings.volume, tracked.mount]))
  if (state.lastError !== "") lines.push(state.lastError)
  return lines.join("\n")
}

// What to do when `gazania watch` exits. null: the watcher never started,
// because setpriv itself could not run; recheck every minute. 127: gazania is
// not installed, recheck every minute. 2 before any hello: clap rejected
// `watch`, so gazania predates 0.2. Anything else: restart with backoff
// doubling from 2 s to 30 s.
function exitDecision(code, sawHello, status, backoffMs) {
  if (status === "outdated") return { status: "outdated", retryMs: 0, nextBackoffMs: backoffMs }
  if (code === null) return { status: "unstartable", retryMs: 60000, nextBackoffMs: 2000 }
  if (code === 127) return { status: "missing", retryMs: 60000, nextBackoffMs: 2000 }
  if (code === 2 && !sawHello) return { status: "outdated", retryMs: 0, nextBackoffMs: backoffMs }
  return { status: "connecting", retryMs: backoffMs, nextBackoffMs: Math.min(backoffMs * 2, 30000) }
}

// nf-md-alert (U+F0026) as a surrogate pair.
var ALERT = "󰀦"

// The caption under the panel title, in capitals like the shell's own hero
// captions. Only the catalog text is capitalised: a mount point is a path,
// and "/mnt/Media" is not "/MNT/MEDIA".
function heroSubtitle(state, settings, status, tr, formatNumber) {
  if (status === "missing") return tr.t("hero.missing").toUpperCase()
  if (status === "unstartable") return tr.t("hero.unstartable").toUpperCase()
  if (pluginOutdated(state, status)) return tr.t("hero.pluginOutdated").toUpperCase()
  if (status === "outdated") return tr.t("hero.gazaniaOutdated").toUpperCase()
  var tracked = trackedVolume(state, settings)
  if (!tracked || !tracked.volume.usage) {
    return (state.hasVolumes ? tr.t("hero.noVolumes") : tr.t("hero.connecting")).toUpperCase()
  }
  return fill(tr.t("hero.freeOn").toUpperCase(), [formatSize(tracked.volume.usage.available, formatNumber), tracked.mount])
}

function volumeLabel(volume) {
  return volume.label ? String(volume.label) : String(volume.device || "")
}

// One row per volume, in stream order; `firstOfDrive` marks where a drive's
// section header goes.
function volumeRows(state, settings, tr, formatNumber) {
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
        mounts: mounts.length > 0 ? mounts.join(", ") : tr.t("volume.notMounted"),
        mount: mounts.length > 0 ? mounts[0] : "",
        sizeText: v.usage
          ? fill(tr.t("volume.usedOfSize"), [formatSize(v.usage.used, formatNumber), formatSize(v.size, formatNumber)])
          : formatSize(v.size, formatNumber),
        freeText: v.usage ? fill(tr.t("space.free"), [formatSize(v.usage.available, formatNumber)]) : "",
        fraction: percent === null ? 0 : percent / 100,
        level: level(percent, settings)
      })
    }
  }
  return rows
}

// One block per drive with something to show: temperature, throughput or both.
// Model names and gazania's warning names are data and stay verbatim.
function driveBlocks(state, settings, formatNumber) {
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
      temperatureText: settings.showTemperature && t !== null ? number(Math.round(t), 0, formatNumber) + " °C" : "",
      failing: !!(h && h.failing),
      warningText: h && Array.isArray(h.warnings) && h.warnings.length ? h.warnings.join(", ") : "",
      rateText: settings.showIo && rate
        ? "↓ " + formatRate(rate.read, formatNumber) + "  ↑ " + formatRate(rate.write, formatNumber)
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
    barIcon: barIcon,
    showsLabel: showsLabel,
    barLabel: barLabel,
    barLevel: barLevel,
    slotWidth: slotWidth,
    pluginOutdated: pluginOutdated,
    tooltip: tooltip,
    exitDecision: exitDecision,
    ALERT: ALERT,
    heroSubtitle: heroSubtitle,
    volumeRows: volumeRows,
    driveBlocks: driveBlocks,
    sparkline: sparkline,
    stepCursor: stepCursor,
    shellQuote: shellQuote,
    fill: fill
  }
}
