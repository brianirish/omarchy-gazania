# Contributing

Thanks for helping improve the Gazania bar widget.

## Development setup

The plugin is developed in place. Clone it where Omarchy loads plugins from:

    git clone https://github.com/brianirish/omarchy-gazania.git \
      ~/.config/omarchy/plugins/brianirish.gazania
    omarchy-shell shell rescanPlugins
    omarchy plugin enable brianirish.gazania

The widget needs `gazania` 0.2 or newer on `PATH`; it runs `gazania watch`
and renders what that stream reports.

## Iterating

- Saving files under `~/.config/omarchy/plugins/` reloads plugin code. When a
  change does not show up, run `omarchy restart shell`.
- Watch for QML errors with `journalctl --user -f | grep -i qml`.
- Keep logic in `Model.js`, free of QML imports, so `node tests/model_test.js`
  keeps running. `Panel.qml` stays a thin layer: run the stream, hand lines to
  `Model`, render the view models it returns.
- Add or update a test in `tests/model_test.js` for every behaviour change in
  `Model.js`.
- Every QML `Text` declares `textFormat: Text.PlainText`; Omarchy's scanner,
  which `scripts/check` runs, fails otherwise.
- Run `scripts/check` before opening a PR. It is exactly what CI runs.

## Pull requests

- One logical change per PR.
- Update `CHANGELOG.md` under an `Unreleased` heading.
- Include a screenshot for visual changes (`omarchy capture screenshot`).
- Note the Omarchy and gazania versions you tested on.

## Bugs and ideas

Open an issue using the templates. For security problems, see
[SECURITY.md](SECURITY.md) and please do not open a public issue.
