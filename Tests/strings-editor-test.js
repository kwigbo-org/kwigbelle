// The self-serve copy editor page (docs/tads/strings.md Decision
// 8): every Strings entry renders as a described form field; plain
// edits and template edits round-trip into a generated Strings.js
// that imports cleanly and carries the edits; breaking a
// placeholder blocks sharing with an inline error; drafts persist
// across a reload. Also asserts meta coverage: every key described,
// no orphan descriptions.
const { chromium } = require("playwright-core");
const { check } = require("./check.js");

(async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

	await page.goto("http://localhost:8741/avastars-editor.html");
	await page.waitForSelector("#editorShare", { timeout: 10000 });

	// Meta coverage: every key described, no orphan descriptions —
	// asserted in the browser, where the ES modules load natively
	const coverage = await page.evaluate(async () => {
		const { Strings } = await import("./Lib/Strings.js");
		const { StringsMeta } = await import("./Lib/StringsMeta.js");
		const stringKeys = [];
		const missingGroups = [];
		for (const [group, entries] of Object.entries(Strings)) {
			if (!StringsMeta.groups[group]) {
				missingGroups.push(group);
			}
			for (const name of Object.keys(entries)) {
				stringKeys.push(`${group}.${name}`);
			}
		}
		return {
			total: stringKeys.length,
			groupCount: Object.keys(Strings).length,
			missingGroups,
			undescribed: stringKeys.filter((key) => !StringsMeta.keys[key]),
			orphans: Object.keys(StringsMeta.keys).filter(
				(key) => !stringKeys.includes(key),
			),
		};
	});
	check(
		coverage.missingGroups.length === 0,
		"groups without meta: " + coverage.missingGroups.join(", "),
	);
	check(
		coverage.undescribed.length === 0,
		"keys without descriptions: " + coverage.undescribed.join(", "),
	);
	check(
		coverage.orphans.length === 0,
		"orphan descriptions: " + coverage.orphans.join(", "),
	);
	console.log(`meta coverage: ${coverage.total} keys described`);

	const counts = await page.evaluate(() => ({
		fields: document.querySelectorAll(".editorInput").length,
		missing: [...document.querySelectorAll(".editorDescription")].filter(
			(label) => label.innerText.includes("missing description"),
		).length,
		status: document.getElementById("editorStatus").innerText,
	}));
	check(
		counts.fields === coverage.total,
		`expected ${coverage.total} fields, got ${counts.fields}`,
	);
	check(counts.missing === 0, `${counts.missing} fields lack descriptions`);
	check(counts.status === "No changes yet", "status wrong: " + counts.status);

	// Edit a plain string and a template's words
	const plain = page.locator('textarea[data-key="load.button"]');
	await plain.fill("Fetch");
	const template = page.locator('textarea[data-key="load.errorUnknown"]');
	await template.fill("`There is no Avastar with id ${tokenId}`");
	const okState = await page.evaluate(() => ({
		status: document.getElementById("editorStatus").innerText,
		disabled: document.getElementById("editorShare").disabled,
		errors: document.querySelectorAll(".hasError").length,
	}));
	check(okState.status === "2 changes ready", "status: " + okState.status);
	check(!okState.disabled && okState.errors === 0, "valid edits flagged");

	// Breaking the placeholder blocks sharing with an inline error
	await template.fill("`There is no such Avastar`");
	const badState = await page.evaluate(() => ({
		disabled: document.getElementById("editorShare").disabled,
		error: document.querySelector(".hasError .editorError")?.innerText,
	}));
	check(badState.disabled, "share stayed enabled with a broken template");
	check(
		(badState.error || "").includes("${tokenId}"),
		"placeholder error missing: " + badState.error,
	);
	await template.fill("`There is no Avastar with id ${tokenId}`");

	// Generate, then import the produced module and verify edits
	const verdict = await page.evaluate(async () => {
		const text = await window.__stringsEditor.generate();
		const url = URL.createObjectURL(
			new Blob([text], { type: "text/javascript" }),
		);
		const module = await import(url);
		URL.revokeObjectURL(url);
		const generated = module.Strings;
		return {
			headerKept: text.startsWith("/// Every editable sentence"),
			button: generated.load.button,
			error: generated.load.errorUnknown(42),
			untouched: generated.panel.effects,
			template: generated.mirror.gapsLine("3", false),
			groups: Object.keys(generated).length,
		};
	});
	check(verdict.headerKept, "generated file lost the header comments");
	check(verdict.button === "Fetch", "plain edit lost: " + verdict.button);
	check(
		verdict.error === "There is no Avastar with id 42",
		"template edit wrong: " + verdict.error,
	);
	check(
		verdict.untouched === "Effects",
		"untouched string changed: " + verdict.untouched,
	);
	check(
		verdict.template === "3 tokens have no VRM to back up (recorded gaps)",
		"untouched template changed: " + verdict.template,
	);
	check(verdict.groups === coverage.groupCount, "generated file lost groups");

	// Drafts survive a reload; discarding restores the original
	await page.reload();
	await page.waitForSelector(".editorDraftBanner", { timeout: 10000 });
	const restored = await page.evaluate(
		() => document.querySelector('textarea[data-key="load.button"]').value,
	);
	check(restored === "Fetch", "draft not restored after reload: " + restored);
	await page.click(".editorDraftBanner button");
	await page.waitForFunction(
		() =>
			document.querySelector('textarea[data-key="load.button"]')?.value ===
			"Load",
		{ timeout: 10000 },
	);

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
	console.log("strings-editor-test complete");
})();
