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

	// Occurrence counting: the validator counts placeholder
	// occurrences, not mere presence, so a multi-use template must
	// keep every occurrence. No current string is a ternary (the
	// last one left with mirror.gapsLine, operator QA 2026-08-31),
	// so this exercises the counter on a three-placeholder template:
	// dropping one of them is caught, restoring clears the error.
	const range = page.locator('textarea[data-key="mirror.knownRange"]');
	const rangeOriginal = await range.inputValue();
	await range.fill("`#${from} – #${until} tokens`");
	check(
		await page.evaluate(() => document.getElementById("editorShare").disabled),
		"dropping a placeholder occurrence went uncaught",
	);
	await range.fill(rangeOriginal);
	check(
		!(await page.evaluate(
			() => document.getElementById("editorShare").disabled,
		)),
		"restoring the knownRange body did not clear the error",
	);

	// MULTI-occurrence counting exercised directly (no in-catalog
	// string repeats a placeholder since gapsLine left): a
	// placeholder the original uses twice must survive twice - one
	// surviving occurrence is NOT enough (the review-catch rule)
	const occurrence = await page.evaluate(async () => {
		const { templateProblem } = await import("./Lib/StringsEditor.js");
		const entry = {
			params: "(count)",
			placeholders: ["${count}", "${count}"],
		};
		return {
			oneOfTwo: templateProblem(entry, "isOne ? `one` : `${count} things`"),
			bothKept: templateProblem(
				entry,
				"isOne ? `${count} thing` : `${count} things`",
			),
		};
	});
	check(
		(occurrence.oneOfTwo || "").includes("${count}"),
		"one-of-two placeholder occurrences went uncaught: " + occurrence.oneOfTwo,
	);
	check(
		occurrence.bothKept === null,
		"both occurrences kept but still flagged: " + occurrence.bothKept,
	);

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
			template: generated.mirror.knownRange("23,000", "23,199", "200"),
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
		verdict.template === "#23,000 – #23,199 · 200 tokens",
		"untouched template changed: " + verdict.template,
	);
	check(verdict.groups === coverage.groupCount, "generated file lost groups");

	// Drafts survive a reload; a draft edit whose key no longer
	// exists (the copy changed underneath it) surfaces as an
	// Unmatched edit - visible, excluded from the export, preserved
	await page.evaluate(() => {
		const draft = JSON.parse(localStorage.getItem("kwigbelle.stringsDraft"));
		draft["legacy.removedKey"] = "an edit of a string that is gone";
		localStorage.setItem("kwigbelle.stringsDraft", JSON.stringify(draft));
	});
	await page.reload();
	await page.waitForSelector(".editorDraftBanner", { timeout: 10000 });
	const restored = await page.evaluate(
		() => document.querySelector('textarea[data-key="load.button"]').value,
	);
	check(restored === "Fetch", "draft not restored after reload: " + restored);
	const orphan = await page.evaluate(async () => {
		const card = document.querySelector(".editorOrphans");
		const text = await window.__stringsEditor.generate();
		const draft = JSON.parse(localStorage.getItem("kwigbelle.stringsDraft"));
		return {
			shown: !!card,
			label: card?.querySelector(".editorDescription")?.innerText,
			value: card?.querySelector("textarea")?.value,
			exported: text.includes("removedKey"),
			status: document.getElementById("editorStatus").innerText,
			persisted: draft["legacy.removedKey"],
		};
	});
	check(orphan.shown, "unmatched-edits card missing");
	check(
		orphan.label === "legacy.removedKey" &&
			orphan.value === "an edit of a string that is gone",
		"orphan edit not surfaced: " + JSON.stringify(orphan),
	);
	check(!orphan.exported, "orphan edit leaked into the export");
	// Two live edits restored; the orphan must NOT make it three
	check(
		orphan.status === "2 changes ready",
		"orphan miscounted: " + orphan.status,
	);
	check(
		orphan.persisted === "an edit of a string that is gone",
		"orphan edit dropped from the stored draft",
	);
	// A fresh keystroke on a live field must not erase the orphan
	await page
		.locator('textarea[data-key="load.placeholder"]')
		.fill("Token number");
	const survived = await page.evaluate(
		() =>
			JSON.parse(localStorage.getItem("kwigbelle.stringsDraft"))[
				"legacy.removedKey"
			],
	);
	check(
		survived === "an edit of a string that is gone",
		"orphan edit erased by a later keystroke",
	);
	await page.click(".editorDraftBanner button");
	await page.waitForFunction(
		() =>
			document.querySelector('textarea[data-key="load.button"]')?.value ===
			"Load Avastar",
		{ timeout: 10000 },
	);

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
	console.log("strings-editor-test complete");
})();
