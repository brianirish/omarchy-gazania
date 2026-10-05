import QtQuick
import QtQuick.Controls
import QtQuick.Shapes
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Gazania in the bar: a disk glyph with one stat, and a panel listing every
// volume with a usage ring plus drive temperature and throughput. All data
// comes from one long-running `gazania watch`; nothing here polls the disks.
Panel {
  id: root
  moduleName: "brianirish.gazania"
  ipcTarget: "brianirish.gazania"

  // A ring covering `fraction` of a circle from twelve o'clock, clockwise.
  component Ring: Shape {
    id: ring
    property real fraction: 0
    property color tone: Color.accent
    readonly property real stroke: Math.max(2, width * 0.14)
    readonly property real ringRadius: (width - stroke) / 2
    preferredRendererType: Shape.CurveRenderer

    ShapePath {
      strokeColor: Qt.rgba(ring.tone.r, ring.tone.g, ring.tone.b, 0.18)
      strokeWidth: ring.stroke
      fillColor: "transparent"
      PathAngleArc {
        centerX: ring.width / 2
        centerY: ring.height / 2
        radiusX: ring.ringRadius
        radiusY: ring.ringRadius
        startAngle: 0
        sweepAngle: 360
      }
    }

    ShapePath {
      strokeColor: ring.fraction > 0 ? ring.tone : "transparent"
      strokeWidth: ring.stroke
      fillColor: "transparent"
      capStyle: ShapePath.RoundCap
      PathAngleArc {
        centerX: ring.width / 2
        centerY: ring.height / 2
        radiusX: ring.ringRadius
        radiusY: ring.ringRadius
        startAngle: -90
        sweepAngle: 360 * Math.min(1, ring.fraction)
      }
    }
  }

  // Read and write throughput over the last Model.HISTORY samples.
  component Sparkline: Shape {
    id: spark
    property var samples: []
    property color readColor: Color.accent
    property color writeColor: Color.muted
    readonly property var points: Model.sparkline(samples, width, height)
    preferredRendererType: Shape.CurveRenderer

    ShapePath {
      strokeColor: spark.readColor
      strokeWidth: 1.5
      fillColor: "transparent"
      PathPolyline {
        path: spark.points.read.map(function(p) { return Qt.point(p.x, p.y) })
      }
    }

    ShapePath {
      strokeColor: spark.writeColor
      strokeWidth: 1.5
      fillColor: "transparent"
      PathPolyline {
        path: spark.points.write.map(function(p) { return Qt.point(p.x, p.y) })
      }
    }
  }

  property var diskState: Model.emptyState()
  // connecting | ok | missing | outdated
  property string streamStatus: "connecting"
  property bool sawHello: false
  property int backoffMs: 2000
  property int cursorIndex: -1

  readonly property var config: Model.withDefaults({
    barStat: setting("barStat", Model.DEFAULTS.barStat),
    volume: setting("volume", Model.DEFAULTS.volume),
    drive: setting("drive", Model.DEFAULTS.drive),
    warnAt: setting("warnAt", Model.DEFAULTS.warnAt),
    criticalAt: setting("criticalAt", Model.DEFAULTS.criticalAt),
    showIo: setting("showIo", Model.DEFAULTS.showIo),
    showTemperature: setting("showTemperature", Model.DEFAULTS.showTemperature)
  })
  readonly property var rows: Model.volumeRows(diskState, config)
  readonly property var driveBlocks: Model.driveBlocks(diskState, config)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color dimForeground: Qt.darker(barForeground, 1.4)
  // Omarchy themes define accent and urgent but no warning color; an even
  // blend of the two keeps the warning tone inside every theme's palette.
  readonly property color warningColor: Qt.tint(Color.accent, Qt.rgba(Color.urgent.r, Color.urgent.g, Color.urgent.b, 0.5))

  function levelColor(level, fallback) {
    if (level === "error") return Color.urgent
    if (level === "warning") return root.warningColor
    return fallback
  }

  function consume(line) {
    var event = Model.parseLine(line)
    if (event === null) return
    if (root.streamStatus === "outdated") return
    if (event.event === "hello") {
      root.sawHello = true
      if (Number(event.protocol) !== Model.PROTOCOL) {
        root.streamStatus = "outdated"
        watcher.running = false
        return
      }
    }
    if (event.event === "volumes") {
      root.backoffMs = 2000
      root.streamStatus = "ok"
    }
    root.diskState = Model.applyEvent(root.diskState, event)
  }

  function watcherExited(code) {
    var decision = Model.exitDecision(code, root.sawHello, root.streamStatus, root.backoffMs)
    root.sawHello = false
    root.streamStatus = decision.status
    root.backoffMs = decision.nextBackoffMs
    if (decision.retryMs > 0) {
      restartTimer.interval = decision.retryMs
      restartTimer.restart()
    }
  }

  function moveCursor(delta) {
    root.cursorIndex = Model.stepCursor(root.cursorIndex, delta, root.rows.length)
  }

  function openApp(mount) {
    if (!root.bar) return
    root.bar.run(mount !== "" ? "gazania-app " + Model.shellQuote(mount) : "gazania-app")
    root.close()
  }

  function openRow(index) {
    var row = root.rows[index]
    root.openApp(row ? row.mount : "")
  }

  onOpenedChanged: if (opened) cursorIndex = -1

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Process {
    id: watcher
    command: ["setpriv", "--pdeathsig", "TERM", "gazania", "watch"]
    running: true
    stdout: SplitParser {
      onRead: function(line) { root.consume(line) }
    }
    onExited: function(exitCode, exitStatus) {
      root.watcherExited(exitStatus === 0 ? exitCode : -1)
    }
  }

  Timer {
    id: restartTimer
    repeat: false
    onTriggered: if (!watcher.running) watcher.running = true
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: Model.barText(root.diskState, root.config, vertical)
    slotSize: Style.bar.iconSlot * Model.slotWidth(root.config, vertical)
    foreground: root.levelColor(Model.barLevel(root.diskState, root.config), root.barForeground)
    dimmed: root.streamStatus !== "ok"
    tooltipText: Model.tooltip(root.diskState, root.config, root.streamStatus)
    onPressed: function(b) { root.toggle() }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(panelColumn.implicitHeight, Style.space(560))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) { if (dy !== 0) root.moveCursor(dy) }
      onActivateRequested: {
        if (root.cursorIndex >= 0) root.openRow(root.cursorIndex)
        else root.openApp("")
      }
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      ScrollView {
        id: scrollArea
        anchors.fill: parent
        clip: true
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
        ScrollBar.vertical.policy: panelColumn.implicitHeight > height ? ScrollBar.AsNeeded : ScrollBar.AlwaysOff
        Binding {
          target: scrollArea.contentItem
          property: "interactive"
          value: panelColumn.implicitHeight > scrollArea.height
        }

        Column {
          id: panelColumn
          width: scrollArea.availableWidth
          spacing: Style.space(14)

          // ---------- Hero: glyph, title, free space on the tracked volume ----------
          Item {
            width: parent.width
            implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight)

            Text {
              id: heroIcon
              textFormat: Text.PlainText
              text: Model.GLYPH
              color: root.barForeground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
            }

            Column {
              id: heroLabels
              anchors.left: heroIcon.right
              anchors.leftMargin: Style.space(14)
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(2)

              Text {
                textFormat: Text.PlainText
                text: "Disks"
                color: root.barForeground
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
                font.bold: true
                width: parent.width
                elide: Text.ElideRight
              }

              Text {
                textFormat: Text.PlainText
                text: Model.heroSubtitle(root.diskState, root.config, root.streamStatus).toUpperCase()
                color: root.dimForeground
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                font.bold: true
                font.letterSpacing: 1.2
                width: parent.width
                elide: Text.ElideRight
              }

              Text {
                textFormat: Text.PlainText
                visible: root.diskState.lastError !== ""
                text: root.diskState.lastError
                color: root.dimForeground
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                width: parent.width
                wrapMode: Text.Wrap
              }
            }
          }

          PanelSeparator {
            foreground: root.barForeground
          }

          // ---------- Volumes, grouped under their drive ----------
          Column {
            width: parent.width
            spacing: Style.space(4)

            Repeater {
              model: root.rows.length

              delegate: Column {
                id: rowItem
                required property int index
                readonly property var row: root.rows[index] || ({})
                width: parent ? parent.width : 0
                spacing: Style.space(4)

                PanelSectionHeader {
                  visible: rowItem.row.firstOfDrive
                  width: parent.width
                  elide: Text.ElideRight
                  text: rowItem.row.driveModel
                  foreground: root.barForeground
                  fontFamily: root.fontFamily
                }

                Rectangle {
                  width: parent.width
                  implicitHeight: rowContent.implicitHeight + Style.space(8)
                  radius: Style.cornerRadius
                  color: root.cursorIndex === rowItem.index ? Style.hoverFill : "transparent"

                  Item {
                    id: rowContent
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.leftMargin: Style.space(4)
                    anchors.rightMargin: Style.space(4)
                    implicitHeight: Math.max(ring.height, labels.implicitHeight, numbers.implicitHeight)

                    Ring {
                      id: ring
                      width: Style.space(22)
                      height: width
                      anchors.left: parent.left
                      anchors.verticalCenter: parent.verticalCenter
                      fraction: rowItem.row.fraction
                      tone: root.levelColor(rowItem.row.level, Color.accent)
                    }

                    Column {
                      id: labels
                      anchors.left: ring.right
                      anchors.leftMargin: Style.space(10)
                      anchors.right: numbers.left
                      anchors.rightMargin: Style.space(10)
                      anchors.verticalCenter: parent.verticalCenter
                      spacing: Style.space(1)

                      Text {
                        textFormat: Text.PlainText
                        text: rowItem.row.label
                        color: root.barForeground
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.body
                        font.bold: true
                        width: parent.width
                        elide: Text.ElideRight
                      }

                      Text {
                        textFormat: Text.PlainText
                        text: rowItem.row.mounts
                        color: root.dimForeground
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.caption
                        width: parent.width
                        elide: Text.ElideRight
                      }
                    }

                    Column {
                      id: numbers
                      anchors.right: parent.right
                      anchors.verticalCenter: parent.verticalCenter
                      spacing: Style.space(1)

                      Text {
                        anchors.right: parent.right
                        textFormat: Text.PlainText
                        text: rowItem.row.sizeText
                        color: root.barForeground
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.body
                      }

                      Text {
                        anchors.right: parent.right
                        textFormat: Text.PlainText
                        visible: text !== ""
                        text: rowItem.row.freeText
                        color: root.dimForeground
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.caption
                      }
                    }
                  }

                  MouseArea {
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onEntered: root.cursorIndex = rowItem.index
                    onClicked: root.openRow(rowItem.index)
                  }
                }
              }
            }
          }

          // ---------- Drives: temperature, throughput, sparkline ----------
          PanelSeparator {
            visible: root.driveBlocks.length > 0
            foreground: root.barForeground
          }

          Column {
            visible: root.driveBlocks.length > 0
            width: parent.width
            spacing: Style.space(10)

            PanelSectionHeader {
              text: "Drives"
              foreground: root.barForeground
              fontFamily: root.fontFamily
            }

            Repeater {
              model: root.driveBlocks.length

              delegate: Column {
                id: driveItem
                required property int index
                readonly property var block: root.driveBlocks[index] || ({})
                width: parent ? parent.width : 0
                spacing: Style.space(4)

                Item {
                  width: parent.width
                  implicitHeight: Math.max(driveName.implicitHeight, driveTemp.implicitHeight)

                  Text {
                    id: driveName
                    textFormat: Text.PlainText
                    text: driveItem.block.model
                    color: root.barForeground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    anchors.left: parent.left
                    anchors.right: driveTemp.left
                    anchors.rightMargin: Style.space(10)
                    elide: Text.ElideRight
                  }

                  Text {
                    id: driveTemp
                    textFormat: Text.PlainText
                    visible: text !== ""
                    text: (driveItem.block.temperatureText + (driveItem.block.failing ? " " + Model.ALERT : "")).trim()
                    color: driveItem.block.failing ? Color.urgent : root.barForeground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    anchors.right: parent.right
                  }
                }

                Text {
                  textFormat: Text.PlainText
                  visible: driveItem.block.warningText !== ""
                  text: driveItem.block.warningText
                  color: Color.urgent
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  width: parent.width
                  wrapMode: Text.Wrap
                }

                Text {
                  textFormat: Text.PlainText
                  visible: driveItem.block.rateText !== ""
                  text: driveItem.block.rateText
                  color: root.dimForeground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                }

                Sparkline {
                  visible: driveItem.block.showIo
                  width: parent.width
                  height: Style.space(28)
                  samples: root.diskState.history[driveItem.block.device] || []
                  writeColor: root.dimForeground
                }
              }
            }
          }

          PanelSeparator {
            foreground: root.barForeground
          }

          Button {
            text: "Open Gazania"
            iconText: Model.GLYPH
            foreground: root.barForeground
            fontFamily: root.fontFamily
            bordered: true
            onClicked: root.openApp("")
          }
        }
      }
    }
  }
}
