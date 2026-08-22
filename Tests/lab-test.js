// Trait swap preview (docs/tads/avastar-lab.md Steps 3-5): the
// edit modal lists the slot's traits (gender-filtered, show-all),
// applying an override changes the canvas and shows was/undo, undo
// restores the exact baseline pixels, Reset all works, and loading
// another token clears overrides.
const { chromium } = require("playwright-core");
const { check } = require("./check.js");

(async () => {
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
		overrideState.was.includes("was: Pigtails"),
		"original trait not shown: " + overrideState.was,
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
	await page.fill("#loadTokenInput", "12345");
	await page.press("#loadTokenInput", "Enter");
	await page.waitForFunction(
		() =>
			!document.querySelector(".resetAll") &&
			document.getElementById("preloader").style.opacity === "0" &&
			[...document.querySelectorAll(".traitValue")].length === 12,
		{ timeout: 15000 },
	);
	const afterSwap = await page.evaluate(() => ({
		undoCount: document.querySelectorAll(".traitUndo").length,
		firstTrait: document.querySelector(".traitValue").innerText,
	}));
	console.log("after token swap:", JSON.stringify(afterSwap));
	check(afterSwap.undoCount === 0, "overrides survived a token swap");
	check(afterSwap.firstTrait === "Alien", "12345 did not load");

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
