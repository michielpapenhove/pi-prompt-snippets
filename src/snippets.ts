/**
 * Prompt snippets: scanner + formatter.
 * No pi imports on purpose; safe to run and test with plain node.
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

export interface Snippet {
	/** Path relative to the snippets root, e.g. "research/evidence.md" */
	relPath: string;
	/** Folder relative to root, "" for root level, e.g. "research" */
	folder: string;
	name: string;
	description: string;
	content: string;
	/** Formatted block pasted into the prompt */
	block: string;
}

export type AttachMode = "editor" | "message";

function stripQuotes(value: string): string {
	if (value.length >= 2) {
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			return value.slice(1, -1);
		}
	}
	return value;
}

/** Parse YAML-ish frontmatter: name/description keys plus the markdown body. */
export function parseSnippetMarkdown(raw: string): { meta: Record<string, string>; content: string } {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { meta: {}, content: raw.trim() };

	const [, metaBlock, body] = match;
	const meta: Record<string, string> = {};
	for (const line of metaBlock.split(/\r?\n/)) {
		const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
		if (!m) continue;
		meta[m[1]!.toLowerCase()] = stripQuotes(m[2]!.trim());
	}
	return { meta, content: body.trim() };
}

export function buildBlock(name: string, content: string): string {
	return `---\n[Prompt snippet: ${name}]\n${content}\n---`;
}

export function snippetFromFile(relPath: string, raw: string): Snippet {
	const { meta, content } = parseSnippetMarkdown(raw);
	const name = meta["name"]?.trim() || basename(relPath, ".md");
	const folder = dirname(relPath) === "." ? "" : dirname(relPath).split(sep).join("/");
	return {
		relPath,
		folder,
		name,
		description: meta["description"]?.trim() ?? "",
		content,
		block: buildBlock(name, content),
	};
}

/**
 * Recursively scan the snippets root. Re-read on every call so new or edited
 * snippets are picked up without /reload (hot reload by construction).
 */
export async function loadSnippets(root: string): Promise<Snippet[]> {
	const out: Snippet[] = [];
	const walk = async (dir: string) => {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		const visible = entries.filter((e) => !e.name.startsWith("."));
		visible.sort((a, b) => a.name.localeCompare(b.name));
		// Files first, then subfolders: each folder stays together, with its own
		// files appearing before deeper nesting.
		for (const entry of [...visible.filter((e) => !e.isDirectory()), ...visible.filter((e) => e.isDirectory())]) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			if (!entry.name.toLowerCase().endsWith(".md")) continue;
			const rel = relative(root, full);
			const raw = await readFile(full, "utf8");
			if (raw.trim().length === 0) continue;
			out.push(snippetFromFile(rel, raw));
		}
	};
	await walk(root);
	return out;
}
