// Side panel harness (docs/tads/side-panel.md): the right-side
// panel opens, Pause freezes the canvas and unpausing resumes it,
// trait rows match the composed layers, hiding everything empties
// the canvas center, and effects settings survive a reload.
const { chromium } = require("playwright-core");
const { check } = require("./check.js");

// A mock wallet so the picker exists: the in-page token-swap reset
// (finishLoad -> traitsSection.update) can only be exercised by an
// actual pick, not by a navigation that rebuilds all JS state.
const MOCK_PROVIDER = `
window.__ownedIds = [8014, 25495, 25470];
window.ethereum = {
	isMetaMask: true,
	on: () => {},
	removeListener: () => {},
	request: async ({ method, params }) => {
		if (method === "eth_accounts" || method === "eth_requestAccounts") {
			return ["0x1111111111111111111111111111111111111111"];
		}
		if (method === "eth_chainId") return "0x1";
		if (method === "net_version") return "1";
		if (method === "eth_blockNumber") return "0x1";
		if (method === "eth_call") {
			const w3 = new Web3();
			const abi = w3.eth.abi;
			const data = params[0].data;
			const sel = data.slice(0, 10);
			const sig = (s) => abi.encodeFunctionSignature(s);
			if (sel === sig("balanceOf(address)")) {
				return abi.encodeParameter("uint256", window.__ownedIds.length);
			}
			if (sel === sig("tokenOfOwnerByIndex(address,uint256)")) {
				const index = parseInt(data.slice(-64), 16);
				return abi.encodeParameter("uint256", window.__ownedIds[index]);
			}
			if (sel === sig("renderAvastar(uint256)")) {
				const id = parseInt(data.slice(-64), 16);
				const res = await fetch("/SVG/Avastar-" + id + ".svg");
				if (!res.ok) throw new Error("no svg for " + id);
				return abi.encodeParameter("string", await res.text());
			}
			throw new Error("unmocked eth_call selector " + sel);
		}
		throw new Error("unmocked method " + method);
	},
};
`;

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

	await page.addInitScript(MOCK_PROVIDER);
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

	// Traits: 4 info rows (color genes) + backdrop + one row per
	// composed layer (8014 has 7); only the last 8 have checkboxes
	const traitRows = await page.locator(".traitRow").count();
	const infoRows = await page.locator(".traitRow.info").count();
	const checkboxes = await page.locator(".traitRow input").count();
	console.log(
		"trait rows:",
		traitRows,
		"info:",
		infoRows,
		"toggles:",
		checkboxes,
	);
	check(traitRows === 12, "expected 12 trait rows, got " + traitRows);
	check(infoRows === 4, "expected 4 color info rows, got " + infoRows);
	check(checkboxes === 8, "expected 8 toggleable rows, got " + checkboxes);
	const swatchColors = await page.evaluate(() =>
		[...document.querySelectorAll(".traitSwatch")].map(
			(swatch) => swatch.style.backgroundColor,
		),
	);
	console.log("swatches:", JSON.stringify(swatchColors));
	check(
		swatchColors.length === 4 && swatchColors.every((color) => color !== ""),
		"expected 4 filled color swatches: " + JSON.stringify(swatchColors),
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

	// In-page token swap resets visibility: hide a trait on the
	// current token, pick a different one through the picker (real
	// finishLoad -> update path, no navigation), and the rebuilt
	// rows must all be checked again
	await page.waitForSelector(".pickerThumb.current img", { timeout: 15000 });
	await page.locator(".traitRow input").nth(2).uncheck();
	const hiddenBefore = await page.evaluate(
		() =>
			[...document.querySelectorAll(".traitRow input")].filter(
				(box) => !box.checked,
			).length,
	);
	check(hiddenBefore === 1, "precondition: expected 1 hidden row");
	await page.click(".pickerThumb.current");
	await page.waitForFunction(
		() => document.querySelectorAll("#pickerList img").length === 3,
		{ timeout: 20000 },
	);
	await page.locator("#pickerList .pickerThumb").nth(1).click();
	await page.waitForFunction(
		() =>
			!document.getElementById("pickerList").classList.contains("expanded") &&
			document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.waitForTimeout(500);
	const swapState = await page.evaluate(() => {
		const boxes = [...document.querySelectorAll(".traitRow input")];
		return {
			count: boxes.length,
			unchecked: boxes.filter((box) => !box.checked).length,
		};
	});
	console.log("after in-page swap:", JSON.stringify(swapState));
	check(
		swapState.count === 8,
		"expected 8 rows after swap, got " + swapState.count,
	);
	check(
		swapState.unchecked === 0,
		swapState.unchecked + " rows unchecked after in-page token swap",
	);

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
