import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Disk glyph in the bar that opens the Gazania app.
Panel {
  id: root
  moduleName: "brianirish.gazania"
  ipcTarget: "brianirish.gazania"

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: Model.GLYPH
    tooltipText: "Gazania"
    onPressed: function(b) {
      if (root.bar) root.bar.run("gazania-app")
    }
  }
}
