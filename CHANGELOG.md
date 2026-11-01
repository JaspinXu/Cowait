# Changelog

## 1.0.0 · 2026-11-01

The first version meant for other people, released as open source (MIT): every feature free, no account.

**Review**
- Changes are grouped by Claude turn: the turn's title (the first line of your message, kept on your machine), how long it took, whether tests passed, and its files as a row you move through.
- `Y` approves a whole turn. Only files that stayed on screen long enough count as reviewed; the rest are approved but not counted.
- Enter on the "Claude finished" alert jumps to that turn's unread files.
- Changes left unreviewed for more than a day are archived (counted as skipped).

**Play**
- The Play tab is a list of three games: Debug Dungeon, **Stack Puzzle** (one a day, the same for everyone, with a spoiler-free share line; practice puzzles too) and **Code Sprint** (type 5 lines, often the ones Claude just wrote).
- Debug Dungeon overtime mode: tougher bugs, double win reward.

**Progress**
- XP and levels, a daily streak (useful days only), three daily quests, 21 achievements, a weekly recap.
- A new **Me** tab: level, streak, quests, achievements, settings.

**First run and polish**
- A welcome screen that hooks Cowait into the current project with one key, and switches language with `L`.
- One footer line with the current tab's keys; feedback first, rewards after.
- Help fits a 60×26 pane; every screen is checked at 60 and 46 columns in both languages.

**Install and tools**
- `npm install -g cowait-cli` (the command is still `cowait`). Standalone binaries for Windows, macOS and Linux (no Node needed) on GitHub Releases, with install scripts that verify SHA-256 and update in place.
- `cowait hook` for binary installs (about 32 ms per call on Windows), `cowait update`, `cowait split` for zellij, WezTerm, kitty and iTerm2 too.
- `cowait report`: a light HTML (or Markdown) review report per day and project.
- A product page in `site/`; CI on Windows, macOS and Linux; tagged releases build, sign and publish automatically.

## 0.2.0 · 2026-11-01

One card per file, notes to Claude at any time, honest reviews (skims don't count), a narrow-pane layout.

## 0.1.0 · 2026-11-01

Review cards, Debug Dungeon, flashcards, the hook and the economy.
