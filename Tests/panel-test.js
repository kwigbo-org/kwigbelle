// Side panel harness (docs/tads/side-panel.md): the right-side
// panel opens, Pause freezes the canvas and unpausing resumes it,
// trait rows match the composed layers, hiding everything empties
// the canvas center, and effects settings survive a reload.
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

	await page.goto("http://localhost:8741/index.html?tokenid=8014");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.waitForTimeout(1200);

	// Open the panel via the handle
	check(
		(await page.locator("#panelHandle").count()) === 1,
		"panel handle missing",
	);
	await page.click("#panelHandle");
	const isOpen = await page.evaluate(() =>
		document.getElementById("sidePanel").classList.contains("open"),
	);
	check(isOpen, "panel did not open");
	await page.screenshot({ path: "panel-open.png" });

	// Traits: backdrop row + one row per composed layer (8014 has 7)
	const traitRows = await page.locator(".traitRow").count();
	console.log("trait rows:", traitRows);
	check(
		traitRows === 8,
		"expected 8 trait rows (backdrop + 7), got " + traitRows,
	);

	// Pause: two frames far apart must be identical, then differ
	// again once unpaused (the breathing motion resumes)
	const frame = () =>
		page.evaluate(() => document.getElementById("mainCanvas").toDataURL());
	const pauseRow = page.locator(".effectRow", { hasText: "Pause motion" });
	await pauseRow.locator("input").check();
	await page.waitForTimeout(300);
	const pausedA = await frame();
	await page.waitForTimeout(500);
	const pausedB = await frame();
	check(pausedA === pausedB, "canvas still changing while paused");
	await pauseRow.locator("input").uncheck();
	await page.waitForTimeout(700);
	const resumed = await frame();
	check(resumed !== pausedB, "canvas did not resume after unpause");
	console.log("pause freeze/resume verified");

	// Hide every trait + backdrop: the canvas center goes empty
	const rows = page.locator(".traitRow input");
	const rowCount = await rows.count();
	for (let i = 0; i < rowCount; i++) {
		await rows.nth(i).uncheck();
	}
	await page.waitForTimeout(300);
	const centerAlpha = await page.evaluate(() => {
		const c = document.getElementById("mainCanvas");
		return c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1)
			.data[3];
	});
	console.log("all hidden, center alpha:", centerAlpha);
	check(centerAlpha === 0, "canvas center not empty with all traits hidden");
	// Show one again: it comes back
	await rows.nth(0).check();
	await page.waitForTimeout(300);
	const backAlpha = await page.evaluate(() => {
		const c = document.getElementById("mainCanvas");
		return c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1)
			.data[3];
	});
	check(backAlpha !== 0, "re-checked trait did not redraw");
	await page.screenshot({ path: "panel-traits.png" });

	// Effects persist: set Motion to 0 and reload
	await page.getByRole("slider", { name: "Motion" }).evaluate((slider) => {
		slider.value = "0";
		// input applies live; change (drag release) persists
		slider.dispatchEvent(new Event("input", { bubbles: true }));
		slider.dispatchEvent(new Event("change", { bubbles: true }));
	});
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem("kwigbelle.effects")),
	);
	check(stored && stored.motion === 0, "motion setting not persisted");
	await page.reload();
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.click("#panelHandle");
	const motionAfter = await page
		.getByRole("slider", { name: "Motion" })
		.inputValue();
	console.log("motion after reload:", motionAfter);
	check(motionAfter === "0", "motion setting did not survive reload");

	// Token swap resets visibility: rows all checked for a new token
	await page.goto("http://localhost:8741/index.html?tokenid=25495");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.click("#panelHandle");
	const uncheckedCount = await page.evaluate(
		() =>
			[...document.querySelectorAll(".traitRow input")].filter(
				(box) => !box.checked,
			).length,
	);
	check(
		uncheckedCount === 0,
		uncheckedCount + " rows unchecked after token swap",
	);

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
