# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-11-09

Omarchy 4.5 support. 2.0 needs Omarchy 4.5 or newer; on 4.0, stay on 1.0.0
(`git -C ~/.config/omarchy/plugins/brianirish.gazania checkout v1.0.0`).

### Changed

- Requires Omarchy 4.5 or newer. On Omarchy 4.0, stay on v1.0.0.
- The stat is drawn as a label before the disk icon ("65% 󰋊"), as the
  built-in battery does. Omarchy 4.5 fits a bar button's text into one icon
  box, which shrank "󰋊 65%" until it could not be read. The `io` stat has a
  wider slot, so its widest label fits.
- The widget's text follows the language picked under Setup > Language, from
  catalogs in `i18n/` for all 50 Omarchy languages (machine-translated from
  English; corrections welcome). Sizes, rates and temperatures use that language's
  digits and decimal separator; unit letters stay as they are.
- The panel caption no longer capitalises the mount point it names.
- In right-to-left languages the throughput sparkline runs right to left,
  newest at the left, as the shell's own strips do.
- `scripts/check` and CI type-check the QML against Omarchy's own components,
  and CI repeats that weekly against the newest Omarchy release.

### Fixed

- When gazania is newer than the widget, the tooltip and panel now ask to
  update the bar plugin instead of gazania (#1).
- When `setpriv` itself cannot start, the widget says so and tries again
  every minute, instead of showing "connecting" forever (#2).
- With more volumes than fit, the panel scrolls to keep the keyboard
  highlight in view (#3).
- A volume whose size udisks2 does not report shows a dash instead of "0B",
  and a `warnAt` above `criticalAt` is read as the two thresholds swapped
  (#4).

## [1.0.0] - 2026-10-05

### Added

- Bar widget showing free space, throughput or temperature beside a disk
  glyph, fed by one `gazania watch` stream.
- Panel listing every volume with a usage ring, plus drive temperature,
  throughput and a 30-second sparkline, and a button that opens Gazania.
- Settings for the bar stat, the tracked volume and drive, the warning
  thresholds and which drive details show.

[2.0.0]: https://github.com/brianirish/omarchy-gazania/releases/tag/v2.0.0
[1.0.0]: https://github.com/brianirish/omarchy-gazania/releases/tag/v1.0.0
