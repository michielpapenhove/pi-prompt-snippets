/**
 * Prompt snippets extension.
 *
 * Alt+S opens an overlay with markdown snippets from PI_SNIPPETS_DIR
 * (default ~/.pi/agent/snippets, recursive, re-read on every open).
 * Type to filter (name, description, folder), toggle checkboxes with space,
 * pick the attach mode with alt+d, apply with enter, cancel with escape
 * (escape first clears the query).
 *
 * Attach modes:
 *  - editor: snippet blocks are pasted into the editor text
 *  - message: blocks are appended to the next submitted prompt as one block
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth, type Focusable, type KeyId } from "@earendil-works/pi-tui";
import { cp } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnippets, type AttachMode, type Snippet } from "./snippets.ts";

/** Package root, so the bundled starter snippets travel with the extension. */
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STARTER_DIR = join(PACKAGE_ROOT, "snippets");

const SHORTCUT = (process.env["PI_SNIPPETS_SHORTCUT"]?.trim() || "alt+s") as KeyId;

interface ApplyResult {
	selected: Snippet[];
	attach: AttachMode;
}

type Category = {
	label: string;
	items: Snippet[];
};

/** Group by TOP-LEVEL folder (one level; deeper folders fall back to their first segment). */
function groupCategories(snippets: Snippet[]): Category[] {
	const order = new Map<string, Category>();
	for (const snippet of snippets) {
		const label = snippet.folder.split("/")[0] || "snippets";
		let cat = order.get(label);
		if (!cat) {
			cat = { label, items: [] };
			order.set(label, cat);
		}
		cat.items.push(snippet);
	}
	return [...order.values()];
}

function truncate(text: string, maxWidth: number): string {
	if (visibleWidth(text) <= maxWidth) return text;
	let out = "";
	for (const ch of text) {
		if (visibleWidth(out + ch) > maxWidth - 1) break;
		out += ch;
	}
	return out + "…";
}

function snippetsRoot(): string {
	const configured = process.env["PI_SNIPPETS_DIR"]?.trim();
	if (!configured) return join(homedir(), ".pi", "agent", "snippets");
	const expanded = configured.replace(/^~(?=$|\/)/, homedir());
	return resolve(expanded);
}

function prettyPath(path: string): string {
	const home = homedir();
	return path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}

/** First run: copy the bundled starter snippets when the snippets root does not exist yet. */
async function seedStarters(root: string): Promise<boolean> {
	try {
		await cp(STARTER_DIR, root, { recursive: true, errorOnExist: false });
		return true;
	} catch {
		return false;
	}
}

class SnippetOverlay implements Focusable {
	readonly width = 68;
	focused = false;

	private theme: Theme;
	private root: string;
	private done: (result: ApplyResult | null) => void;
	private cats: Category[]; // all categories; apply() uses these (including filtered-out checks)
	private view: Category[]; // visible categories (filtered by the search query)
	private query = "";
	private catIdx = 0; // active (expanded) category
	private itemIdx = -1; // -1 = cursor on a category header, otherwise the item index
	private checked = new Set<string>();
	private attach: AttachMode = "editor";

	constructor(theme: Theme, root: string, snippets: Snippet[], done: (result: ApplyResult | null) => void) {
		this.theme = theme;
		this.root = root;
		this.done = done;
		this.cats = groupCategories(snippets);
		this.view = this.cats;
	}

	/** Visible categories for the current query (case-insensitive, words are ANDed). */
	private rebuildView(): Category[] {
		const q = this.query.trim().toLowerCase();
		if (!q) return this.cats;
		const words = q.split(/\s+/);
		return this.cats
			.map((cat) => ({
				label: cat.label,
				items: cat.items.filter((snippet) => {
					const hay = `${snippet.name} ${snippet.description} ${snippet.folder}`.toLowerCase();
					return words.every((word) => hay.includes(word));
				}),
			}))
			.filter((cat) => cat.items.length > 0);
	}

	private setQuery(query: string): void {
		this.query = query;
		this.view = this.rebuildView();
		this.catIdx = 0;
		this.itemIdx = this.view[0]?.items.length ? 0 : -1;
	}

	private selectedSnippet(): Snippet | undefined {
		if (this.itemIdx < 0) return undefined;
		return this.view[this.catIdx]?.items[this.itemIdx];
	}

	private jumpToTop(): void {
		this.catIdx = 0;
		this.itemIdx = 0;
	}

	private jumpToBottom(): void {
		this.catIdx = this.view.length - 1;
		const last = this.view[this.catIdx]!;
		this.itemIdx = last.items.length - 1;
	}

	private move(delta: number): void {
		if (this.view.length === 0) return;
		const cat = this.view[this.catIdx]!;
		const count = cat.items.length;
		if (this.itemIdx === -1) {
			if (delta > 0) {
				if (count > 0) {
					this.itemIdx = 0;
				} else {
					this.catIdx = Math.min(this.view.length - 1, this.catIdx + 1);
				}
			} else if (this.catIdx === 0) {
				// Top (first category header) wraps to the bottom of the whole list.
				this.jumpToBottom();
			} else {
				this.catIdx -= 1;
				const prev = this.view[this.catIdx]!;
				if (prev.items.length > 0) this.itemIdx = prev.items.length - 1;
			}
			return;
		}
		const nextIdx = this.itemIdx + delta;
		if (nextIdx >= 0 && nextIdx < count) {
			this.itemIdx = nextIdx;
		} else if (delta > 0) {
			if (this.catIdx === this.view.length - 1) {
				// Bottom (last item) wraps to the top of the list.
				this.jumpToTop();
			} else {
				this.catIdx += 1;
				this.itemIdx = -1;
			}
		} else if (this.catIdx === 0 && this.itemIdx === 0) {
			// First item wraps to the bottom of the whole list.
			this.jumpToBottom();
		} else {
			this.itemIdx = -1;
		}
	}

	private toggle(): void {
		const snippet = this.selectedSnippet();
		if (!snippet) return;
		if (this.checked.has(snippet.relPath)) this.checked.delete(snippet.relPath);
		else this.checked.add(snippet.relPath);
	}

	private apply(): void {
		const selected: Snippet[] = [];
		for (const cat of this.cats) {
			for (const snippet of cat.items) {
				if (this.checked.has(snippet.relPath)) selected.push(snippet);
			}
		}
		this.done({ selected, attach: this.attach });
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			if (this.query) this.setQuery("");
			else this.done(null);
			return;
		}
		if (matchesKey(data, "up")) {
			this.move(-1);
			return;
		}
		if (matchesKey(data, "down")) {
			this.move(1);
			return;
		}
		if (matchesKey(data, "space")) {
			this.toggle();
			return;
		}
		if (matchesKey(data, "return")) {
			this.apply();
			return;
		}
		if (matchesKey(data, "alt+d")) {
			this.attach = this.attach === "editor" ? "message" : "editor";
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.setQuery(this.query.slice(0, -1));
			return;
		}
		// Any other input is search text (single keys or pasted text; strip line breaks).
		const text = data.replace(/[\r\n\t]/g, "");
		if (!text || /[\u0000-\u001f\u007f]/.test(text)) return;
		this.setQuery(this.query + text);
	}

	render(_width: number): string[] {
		const w = this.width;
		const innerW = w - 2;
		const th = this.theme;
		const lines: string[] = [];

		const pad = (s: string, len: number) => {
			const vis = visibleWidth(s);
			return s + " ".repeat(Math.max(0, len - vis));
		};
		const row = (content: string) => th.fg("border", "│") + pad(content, innerW) + th.fg("border", "│");

		lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
		lines.push(row(` ${th.fg("accent", th.bold("Prompt snippets"))}`));
		const filteredCount = this.query.trim() ? this.view.reduce((n, cat) => n + cat.items.length, 0) : null;
		lines.push(
			row(
				` ${th.fg("dim", `source: ${prettyPath(this.root)} · ${this.cats.length} categories${filteredCount === null ? "" : ` · ${filteredCount} found`}`)}`,
			),
		);
		// Search bar: typing filters on name, description and folder.
		lines.push(
			row(
				truncate(
					` ${th.fg("dim", "Search:")} ${
						this.query ? th.fg("text", this.query) + th.fg("accent", "▌") : th.fg("dim", "type to search…")
					}`,
					innerW - 2,
				),
			),
		);
		lines.push(row(""));

		if (this.view.length === 0) {
			lines.push(row(` ${th.fg("dim", `No matches for "${this.query.trim()}"`)}`));
		}

		for (let i = 0; i < this.view.length; i++) {
			const cat = this.view[i]!;
			const isOpen = i === this.catIdx;
			const onHeader = isOpen && this.itemIdx === -1;
			if (isOpen) {
				const marker = onHeader ? th.fg("accent", "▶ ") : "  ";
				const label = onHeader ? th.fg("accent", cat.label) : th.fg("text", cat.label);
				lines.push(row(truncate(`${marker}${label} ${th.fg("dim", `(${cat.items.length})`)}`, innerW - 2)));
				for (let j = 0; j < cat.items.length; j++) {
					const snippet = cat.items[j]!;
					const isSelected = j === this.itemIdx;
					const isChecked = this.checked.has(snippet.relPath);
					const checkbox = isChecked ? "[x]" : "[ ]";
					const prefix = isSelected ? th.fg("accent", "  ▶ ") : "     ";
					const title =
						prefix + checkbox + " " + (isSelected ? th.fg("accent", snippet.name) : th.fg("text", snippet.name));
					lines.push(row(truncate(title, innerW - 2)));
					if (snippet.description) {
						lines.push(row(truncate("        " + th.fg("muted", snippet.description), innerW - 2)));
					}
				}
			} else {
				lines.push(row(`${th.fg("dim", `── ${cat.label} (${cat.items.length}) ──`)}`));
			}
		}

		lines.push(row(""));
		const editorOn = this.attach === "editor";
		lines.push(
			row(
				truncate(
					` ${th.fg("dim", "Attach as:")} ${editorOn ? th.fg("accent", "[x]") : th.fg("dim", "[ ]")} ${th.fg("text", "editor")}   ${editorOn ? th.fg("dim", "[ ]") : th.fg("accent", "[x]")} ${th.fg("text", "next prompt")}  (${th.fg("dim", "alt+d")})`,
					innerW - 2,
				),
			),
		);
		lines.push(
			row(`${th.fg("dim", "type = search · ↑↓ navigate · space select · enter apply · esc clear/close")}`),
		);
		lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

		return lines;
	}

	invalidate(): void {}
	dispose(): void {}
}

export default function (pi: ExtensionAPI) {
	/** Blocks queued for the next submitted prompt (attach mode "message"). */
	let pendingBlocks: string[] | null = null;

	pi.registerShortcut(SHORTCUT, {
		description: "Attach prompt snippets",
		handler: async (ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Prompt snippets only works in the TUI", "error");
				return;
			}

			const root = snippetsRoot();
			let snippets = await loadSnippets(root);
			if (snippets.length === 0 && (await seedStarters(root))) {
				snippets = await loadSnippets(root);
				if (snippets.length > 0) {
					ctx.ui.notify(`Starter snippets copied to ${prettyPath(root)}`, "info");
				}
			}
			if (snippets.length === 0) {
				ctx.ui.notify(`No snippets found in ${prettyPath(root)}`, "warning");
				return;
			}

			const result = await ctx.ui.custom<ApplyResult | null>(
				(_tui, theme, _keybindings, done) => new SnippetOverlay(theme, root, snippets, done),
				{ overlay: true },
			);

			if (!result || result.selected.length === 0) {
				if (result) ctx.ui.notify("No snippets selected", "info");
				return;
			}

			const { selected, attach } = result;
			const blocks = selected.map((s) => s.block);

			if (attach === "message") {
				pendingBlocks = blocks;
				ctx.ui.notify(
					`${blocks.length} snippet${blocks.length === 1 ? "" : "s"} attached to your next prompt`,
					"info",
				);
				return;
			}

			// "editor": paste blocks into the editor, skipping duplicates
			const current = ctx.ui.getEditorText() ?? "";
			const additions = blocks.filter((b) => !current.includes(b));
			if (additions.length === 0) {
				ctx.ui.notify("Snippets are already in the editor", "info");
				return;
			}
			const sep = current.trim() ? "\n\n" : "";
			ctx.ui.setEditorText(current + sep + additions.join("\n\n"));
			ctx.ui.notify(
				`${additions.length} snippet${additions.length === 1 ? "" : "s"} pasted into the editor`,
				"info",
			);
		},
	});

	// Attach mode "message": append queued blocks to the next interactive prompt.
	pi.on("input", async (event, ctx) => {
		if (event.source !== "interactive" || !pendingBlocks) return;
		const blocks = pendingBlocks;
		pendingBlocks = null;
		if (blocks.length === 0) return;
		return { action: "transform", text: event.text + "\n\n" + blocks.join("\n\n") };
	});
}
