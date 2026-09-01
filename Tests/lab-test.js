// Trait swap preview (docs/tads/avastar-lab.md Steps 3-5): the
// edit modal lists the slot's traits (gender-filtered, show-all),
// applying an override changes the canvas and shows was/undo, undo
// restores the exact baseline pixels, Reset all works, and loading
// another token clears overrides.
const { chromium } = require("playwright-core");
const { check, strings } = require("./check.js");

(async () => {
	const Strings = strings();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
	page.on("console", (m) => {
		if (m.type() === "error") errors.push("console: " + m.text());
	});
	page.on("dialog", (d) => {
		errors.push("dialog: " + d.message());
		d.dismiss();
	});

	// 8014 is female (gender 2); walletless
	// The 3D section's backup indicator HEADs vrm/<file>; the test
	// server has no mirror, so answer 200 to keep the console clean
	await page.route("https://kwigbelle.com/vrm/Avastar_*.vrm", (route) =>
		route.fulfill({ status: 200, body: "" }),
	);
	await page.goto("http://localhost:8741/index.html?tokenid=8014");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.waitForTimeout(1000);
	await page.click("#panelHandle");

	// Freeze motion so canvas frames compare deterministically
	await page
		.locator(".effectRow", { hasText: "Pause motion" })
		.locator("input")
		.check();
	await page.waitForTimeout(300);
	const frame = () =>
		page.evaluate(() => document.getElementById("mainCanvas").toDataURL());
	const baselineFrame = await frame();

	// The trait cards live in the info drawer (docs/tads/info-tab.md)
	await page.click("#infoHandle");

	// Open the Hair Style editor (last trait card)
	const expected = await page.evaluate(async () => {
		const { default: TraitComposer } = await import("./Lib/TraitComposer.js");
		const composer = new TraitComposer();
		const all = await composer.traitsForGene(11);
		return {
			all: all.length,
			filtered: all.filter((t) => t.gender === 0 || t.gender === 2).length,
		};
	});
	// The original trait name comes from the DOM, not a literal, so
	// a library regeneration can't silently break the assertion
	const originalName = await page
		.locator(".traitRow .traitValue")
		.last()
		.innerText();
	await page.locator(".traitRow .traitEdit").last().click();
	await page.waitForSelector("#traitModal .modalOption", { timeout: 15000 });
	const filteredCount = await page.locator(".modalOption").count();
	console.log(
		`modal options: ${filteredCount} (expected filtered ${expected.filtered}, all ${expected.all})`,
	);
	check(
		filteredCount === expected.filtered,
		`gender-filtered count ${filteredCount} != ${expected.filtered}`,
	);
	await page.locator(".modalShowAll input").check();
	await page.waitForTimeout(300);
	const allCount = await page.locator(".modalOption").count();
	check(
		allCount === expected.all,
		`show-all count ${allCount} != ${expected.all}`,
	);
	const currentHighlighted = await page.locator(".modalOption.current").count();
	check(currentHighlighted === 1, "current trait not highlighted exactly once");
	await page.waitForTimeout(1500);
	await page.screenshot({ path: "lab-modal.png" });

	// Text filter: type a visible option's name, expect only matches
	const sampleName = await page.locator(".modalOptionName").first().innerText();
	await page.fill(".modalFilterText", sampleName);
	await page.waitForTimeout(400);
	const textFiltered = await page.evaluate(() =>
		[...document.querySelectorAll(".modalOptionName")].map((n) => n.innerText),
	);
	check(
		textFiltered.length > 0 &&
			textFiltered.every((n) =>
				n.toLowerCase().includes(sampleName.toLowerCase()),
			),
		"text filter returned non-matching options: " +
			JSON.stringify(textFiltered),
	);
	await page.fill(".modalFilterText", "");

	// Rarity filter: pick the first real rarity, expect only that tag
	const rarityValue = await page.evaluate(() => {
		const select = document.querySelector(".modalFilterRarity");
		return select.options[1] ? select.options[1].value : "";
	});
	check(rarityValue !== "", "rarity dropdown has no options");
	await page.selectOption(".modalFilterRarity", rarityValue);
	await page.waitForTimeout(400);
	const rarityTags = await page.evaluate(() =>
		[...document.querySelectorAll(".modalOption .traitRarity")].map(
			(t) => t.innerText,
		),
	);
	check(
		rarityTags.length > 0 && rarityTags.every((t) => t === rarityValue),
		"rarity filter returned non-matching options: " +
			JSON.stringify(rarityTags.slice(0, 5)),
	);
	await page.selectOption(".modalFilterRarity", "");
	await page.waitForTimeout(400);

	// Series filter: pick the first real series, expect every shown
	// option to carry it (verified against the library index)
	const seriesValue = await page.evaluate(() => {
		const select = document.querySelector(".modalFilterSeries");
		return select.options[1] ? select.options[1].value : "";
	});
	check(seriesValue !== "", "series dropdown has no options");
	await page.selectOption(".modalFilterSeries", seriesValue);
	await page.waitForTimeout(400);
	const seriesCheck = await page.evaluate(async (value) => {
		const shown = [...document.querySelectorAll(".modalOptionName")].map(
			(n) => n.innerText,
		);
		const index = await (await fetch("./Traits/index.json")).json();
		const inSeries = new Set(
			Object.values(index)
				.filter(
					(t) => t.gene === 11 && (t.series || []).includes(Number(value)),
				)
				.map((t) => t.name),
		);
		return {
			count: shown.length,
			allMatch: shown.every((name) => inSeries.has(name)),
		};
	}, seriesValue);
	console.log("series filter:", JSON.stringify(seriesCheck));
	check(
		seriesCheck.count > 0 && seriesCheck.allMatch,
		"series filter returned non-matching options",
	);
	await page.selectOption(".modalFilterSeries", "");
	await page.waitForTimeout(400);

	// Pick a different hair style (an option that isn't current)
	const pickedName = await page
		.locator(".modalOption:not(.current) .modalOptionName")
		.first()
		.innerText();
	await page.locator(".modalOption:not(.current)").first().click();
	await page.waitForFunction(() => !document.getElementById("traitModal"), {
		timeout: 5000,
	});
	await page.waitForFunction(
		(name) =>
			[...document.querySelectorAll(".traitValue")].some(
				(v) => v.innerText === name,
			),
		pickedName,
		{ timeout: 15000 },
	);
	await page.waitForTimeout(500);
	const overriddenFrame = await frame();
	check(overriddenFrame !== baselineFrame, "canvas unchanged after override");
	const overrideState = await page.evaluate(() => ({
		was: document.querySelector(".traitWas")?.innerText || "",
		undoCount: document.querySelectorAll(".traitUndo").length,
		resetVisible: !!document.querySelector(".resetAll"),
	}));
	console.log("override state:", JSON.stringify(overrideState));
	check(
		overrideState.was.includes(Strings.traits.was(originalName)),
		`original trait "${originalName}" not shown: ` + overrideState.was,
	);
	check(overrideState.undoCount === 1, "expected exactly one undo control");
	check(overrideState.resetVisible, "Reset all not shown");
	await page.screenshot({ path: "lab-override.png" });

	// Visibility toggle still works on the overridden layer
	await page.locator(".traitRow input").last().uncheck();
	await page.waitForTimeout(300);
	const hiddenFrame = await frame();
	check(
		hiddenFrame !== overriddenFrame,
		"hiding overridden layer changed nothing",
	);
	await page.locator(".traitRow input").last().check();
	await page.waitForTimeout(300);

	// Undo restores the exact baseline pixels (byte-identical
	// composition -> identical frozen frame)
	await page.locator(".traitUndo").click();
	await page.waitForFunction(
		() => document.querySelectorAll(".traitUndo").length === 0,
		{ timeout: 15000 },
	);
	await page.waitForTimeout(500);
	const undoneFrame = await frame();
	check(undoneFrame === baselineFrame, "undo did not restore baseline pixels");

	// Reset all: override again, then reset
	await page.locator(".traitRow .traitEdit").last().click();
	await page.waitForSelector("#traitModal .modalOption", { timeout: 15000 });
	await page.locator(".modalOption:not(.current)").first().click();
	await page.waitForFunction(() => !!document.querySelector(".resetAll"), {
		timeout: 15000,
	});
	await page.locator(".resetAll").click();
	await page.waitForFunction(() => !document.querySelector(".resetAll"), {
		timeout: 15000,
	});
	await page.waitForTimeout(500);
	check(
		(await frame()) === baselineFrame,
		"reset all did not restore baseline",
	);

	// Loading another token clears overrides (no was/undo rows)
	await page.locator(".traitRow .traitEdit").last().click();
	await page.waitForSelector("#traitModal .modalOption", { timeout: 15000 });
	await page.locator(".modalOption:not(.current)").first().click();
	await page.waitForFunction(() => !!document.querySelector(".resetAll"), {
		timeout: 15000,
	});
	const preSwapFirstTrait = await page
		.locator(".traitValue")
		.first()
		.innerText();
	// The load input is a settings section
	await page.click("#panelHandle");
	await page.fill("#loadTokenInput", "12345");
	await page.press("#loadTokenInput", "Enter");
	await page.waitForFunction(
		(before) =>
			!document.querySelector(".resetAll") &&
			document.getElementById("preloader").style.opacity === "0" &&
			[...document.querySelectorAll(".traitValue")].length === 12 &&
			document.querySelector(".traitValue").innerText !== before,
		preSwapFirstTrait,
		{ timeout: 15000 },
	);
	const afterSwap = await page.evaluate(() => ({
		undoCount: document.querySelectorAll(".traitUndo").length,
	}));
	console.log("after token swap:", JSON.stringify(afterSwap));
	check(afterSwap.undoCount === 0, "overrides survived a token swap");

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
