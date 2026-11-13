import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadSnippets, parseSnippetMarkdown, snippetFromFile } from "../src/snippets.ts";

const STARTERS = join(dirname(dirname(fileURLToPath(import.meta.url))), "snippets");

test("frontmatter is parsed into meta and body", () => {
	const parsed = parseSnippetMarkdown('---\nname: "Concise"\ndescription: Short\n---\n\n- one\n');
	assert.equal(parsed.meta["name"], "Concise");
	assert.equal(parsed.meta["description"], "Short");
	assert.equal(parsed.content, "- one");
});

test("a file without frontmatter is all body", () => {
	const parsed = parseSnippetMarkdown("just text\n");
	assert.deepEqual(parsed.meta, {});
	assert.equal(parsed.content, "just text");
});

test("name falls back to the filename and folder to the directory", () => {
	const snippet = snippetFromFile("research/evidence.md", "body");
	assert.equal(snippet.name, "evidence");
	assert.equal(snippet.folder, "research");
	assert.match(snippet.block, /^---\n\[Prompt snippet: evidence\]\nbody\n---$/);
});

test("the bundled starter library loads and every snippet has a body", async () => {
	const snippets = await loadSnippets(STARTERS);
	assert.ok(snippets.length >= 5, `expected starter snippets, got ${snippets.length}`);
	for (const snippet of snippets) {
		assert.ok(snippet.content.length > 0, `${snippet.relPath} has no body`);
		assert.ok(snippet.name.length > 0, `${snippet.relPath} has no name`);
		assert.ok(snippet.folder.length > 0, `${snippet.relPath} is not in a category`);
	}
});

test("a missing root is not an error", async () => {
	assert.deepEqual(await loadSnippets(join(STARTERS, "does-not-exist")), []);
});
