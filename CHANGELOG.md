# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Requires Omarchy 4.5 or newer. On Omarchy 4.0, stay on v1.0.0.
- The stat is drawn as a label before the disk icon ("65% 󰋊"), as the
  built-in battery does. Omarchy 4.5 fits a bar button's text into one icon
  box, which shrank "󰋊 65%" until it could not be read. The `io` stat has a
  wider slot, so its widest label fits.
- The widget's text follows the language picked under Setup > Language, from
  catalogs in `i18n/`. Sizes, rates and temperatures use that language's
  digits and decimal separator; unit letters stay as they are.
- The panel caption no longer capitalises the mount point it names.
- `scripts/check` and CI type-check the QML against Omarchy's own components,
  and CI repeats that weekly against the newest Omarchy release.

### Fixed

- When gazania is newer than the widget, the tooltip and panel now ask to
  update the bar plugin instead of gazania (#1).

## [1.0.0] - 2026-10-05

### Added

- Bar widget showing free space, throughput or temperature beside a disk
  glyph, fed by one `gazania watch` stream.
- Panel listing every volume with a usage ring, plus drive temperature,
  throughput and a 30-second sparkline, and a button that opens Gazania.
- Settings for the bar stat, the tracked volume and drive, the warning
  thresholds and which drive details show.

[1.0.0]: https://github.com/brianirish/omarchy-gazania/releases/tag/v1.0.0
