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
- Run `scripts/check` before opening a PR. It is exactly what CI runs, and
  with an Omarchy shell installed it also type-checks the QML against the
  shell's own components (`scripts/qml-api-lint`).

## Adding a string

Every string the widget shows comes from `i18n/`, so it can follow the
language picked under Setup > Language.

1. Add the key and its English text to `i18n/en.json`. Translators see only
   the key and that text, so make the text clear on its own, and keep a
   sentence whole with `%1`, `%2` placeholders rather than gluing pieces
   together. A string that counts something is a plural entry
   (`{ "one": "%1 drive", "other": "%1 drives" }`).
2. Use it with a literal key: `tr.t("key")` in `Model.js` (the panel passes
   its `strings` as `tr`), or `strings.t("key")` in a QML binding so a
   language switch re-renders it. Never build a key at run time
   (`t("hero." + status)`); the catalog check looks for literal keys.
3. Write numbers through `formatNumber` (`I18n.formatNumber(value,
   decimals)` in the shell), so they take the language's decimal separator.
   Units, brand names and anything gazania reports stay as they are.
4. Run `scripts/check`. It fails on a key the code uses that `en.json` lacks,
   and on a key in `en.json` nothing uses.

Translations into the other languages may lag behind; until they catch up,
a new string shows in English.

## Releasing

Before tagging a release, run `I18N_STRICT=1 scripts/check`. It also
requires a catalog for every Omarchy language with every string translated,
and checks that each translation keeps the English placeholders and its
language's plural forms.

## Pull requests

- One logical change per PR.
- Update `CHANGELOG.md` under an `Unreleased` heading.
- Include a screenshot for visual changes (`omarchy capture screenshot`).
- Note the Omarchy and gazania versions you tested on.

## Bugs and ideas

Open an issue using the templates. For security problems, see
[SECURITY.md](SECURITY.md) and please do not open a public issue.
