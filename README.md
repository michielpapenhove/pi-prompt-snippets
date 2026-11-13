# pi-prompt-snippets

Searchable markdown prompt snippets for [Pi](https://pi.dev), one keystroke away.

`alt+s` opens an overlay with your own snippet library. Type to filter, tick the ones you want with `space`, then drop them into the editor or attach them to your next prompt as a single block. Snippets are plain markdown files on disk, re-read every time you open the overlay, so editing one is the same as editing any other file.

```text
+------------------------------------------------------------------+
| Prompt snippets                                                  |
| source: ~/.pi/agent/snippets - 6 categories                      |
| Search: rev|                                                     |
|                                                                  |
| > research (4)                                                   |
|     [ ] Evidence, not speculation                                |
|         Back every conclusion with a source, or label it as ...  |
|   [x] Read-only investigation                                    |
|         Investigate without changing the system                  |
|   -- code (2) --                                                 |
|                                                                  |
| Attach as: [x] editor   [ ] next prompt  (alt+d)                 |
| type = search - up/down navigate - space select - enter apply    |
+------------------------------------------------------------------+
```

## Install

```bash
pi install git:github.com/michielpapenhove/pi-prompt-snippets
```

Then run `/reload` in Pi, or restart it. Prefer an explicit URL? `pi install git:https://github.com/michielpapenhove/pi-prompt-snippets.git` does the same.

To pin a release: `pi install git:github.com/michielpapenhove/pi-prompt-snippets@v1.0.0`.

Updating later:

```bash
pi update --extensions
```

Removing it: `pi remove git:github.com/michielpapenhove/pi-prompt-snippets`.

Want to try a local checkout instead? `pi install ./pi-prompt-snippets`, or for a single run without touching your settings:

```bash
pi -e ./pi-prompt-snippets
```

## Use

| Key | Action |
|---|---|
| `alt+s` | open the snippet overlay |
| typing | filter on name, description, and folder |
| `up` / `down` | move; wraps around the ends of the list |
| `space` | tick or untick the highlighted snippet |
| `enter` | apply the ticked snippets |
| `alt+d` | switch between "editor" and "next prompt" |
| `esc` | clear the query, or close the overlay |

Two attach modes:

- **editor** puts the snippets in your editor text, where you can edit them before sending. Blocks already in the editor are skipped.
- **next prompt** keeps them queued and appends them to the next message you submit, without touching the editor.

Selection survives filtering: tick a few snippets, search for something else, tick more. Applying sends everything that is ticked.

## Snippets

A snippet is a markdown file with optional frontmatter:

```markdown
---
name: Concise answers
description: Lead with the outcome, cut the preamble
---

- Put the conclusion on the first line, then the minimum needed to support it.
- Drop filler: no restating the question, no apology openers.
```

The body is what gets pasted, wrapped in a `[Prompt snippet: <name>]` marker so the model can tell snippet text from your own words. `name` falls back to the filename and `description` is optional (it only shows in the overlay).

The **top-level folder** becomes the category, so `research/evidence.md` lands under `research`. Deeper nesting works but groups by its first segment. Dotfiles, non-`.md` files, and empty files are ignored.

### Where snippets live

`~/.pi/agent/snippets` by default, or whatever `dir` says (see [configuration](#configuration)).

On first use, when the snippets directory does not exist yet, the bundled starter library is copied there so you have something to edit. This ships with nine snippets: concise answers, evidence over speculation, read-only investigation, staying in scope, smallest working change, review checklist, self-explaining commits, production change with a plan, and reporting when done.

Delete or rewrite them freely; they are yours once copied.

## Configuration

Settings live in your Pi settings file (`~/.pi/agent/settings.json`) under a `prompt-snippets` key. Both fields are optional, and the defaults are what you get without the key:

```json
{
  "prompt-snippets": {
    "dir": "~/notes/prompts",
    "shortcut": "ctrl+alt+s"
  }
}
```

| Key | Default | Purpose |
|---|---|---|
| `dir` | `~/.pi/agent/snippets` | where snippets are read from (`~` is expanded) |
| `shortcut` | `alt+s` | key that opens the overlay, e.g. `ctrl+alt+s` |

The file is read when the extension loads, so run `/reload` after editing. The `PI_SNIPPETS_DIR` and `PI_SNIPPETS_SHORTCUT` environment variables override the settings for a single run, which is handy for trying another library without editing anything:

```bash
PI_SNIPPETS_DIR=~/notes/prompts pi
```

## Limits

- The overlay is TUI-only. In print or RPC mode the shortcut reports that and does nothing.
- Install the extension once. Two copies register the same shortcut twice, and one of them will not fire.

## Development

```bash
npm install
npm run typecheck
npm test        # needs Node 22.6+ for native TypeScript type stripping
pi -e .         # run this checkout without installing it
```

The overlay lives in `src/index.ts`; the scanner and formatter in `src/snippets.ts` have no Pi imports, which keeps them testable with plain node.

## License

MIT
