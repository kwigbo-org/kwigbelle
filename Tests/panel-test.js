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

	// Drawer stack (docs/tads/info-tab.md Decision 1): profile above
	// info above settings, with the Traits section and the rarity
	// explainer living in the info drawer and the controls staying
	// in settings
	const drawerLayout = await page.evaluate(() => ({
		handles: [...document.querySelectorAll("#panelHandles .panelHandle")].map(
			(h) => h.id,
		),
		info: [
			...document.querySelectorAll(
				"#infoSections .panelSectionHeader span:first-child",
			),
		].map((s) => s.textContent),
		settings: [
			...document.querySelectorAll(
				"#panelSections .panelSectionHeader span:first-child",
			),
		].map((s) => s.textContent),
	}));
	console.log("drawer layout:", JSON.stringify(drawerLayout));
	check(
		JSON.stringify(drawerLayout.handles) ===
			JSON.stringify(["profileHandle", "infoHandle", "panelHandle"]),
		"drawer handles out of order: " + JSON.stringify(drawerLayout.handles),
	);
	check(
		JSON.stringify(drawerLayout.info) ===
			JSON.stringify(["How rarity works", "Overview", "Traits"]),
		"info drawer sections wrong: " + JSON.stringify(drawerLayout.info),
	);
	check(
		JSON.stringify(drawerLayout.settings) ===
			JSON.stringify(["Load Avastar", "Effects", "3D model"]),
		"settings drawer sections wrong: " + JSON.stringify(drawerLayout.settings),
	);

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
	check(infoRows === 4, "expected 4 color info rows, got " + infoRows);
	check(checkboxes === 8, "expected 8 toggleable rows, got " + checkboxes);
	// Derived rather than a second constant: every row is either
	// info or toggleable
	check(
		traitRows === infoRows + checkboxes,
		`row total ${traitRows} != info ${infoRows} + toggles ${checkboxes}`,
	);
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

	// Hide every trait + backdrop: the canvas center goes empty.
	// The trait rows live in the info drawer now - switch to it.
	await page.click("#infoHandle");
	const rows = page.locator(".traitRow input");
	const rowCount = await rows.count();
	for (let i = 0; i < rowCount; i++) {
		await rows.nth(i).uncheck();
	}
	await page.waitForTimeout(300);
	// Layers live on #mainCanvas; the backdrop paints on its own
	// #backdropCanvas behind them - both must go empty
	const centerAlphas = () =>
		page.evaluate(() =>
			["mainCanvas", "backdropCanvas"].map((id) => {
				const c = document.getElementById(id);
				return c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1)
					.data[3];
			}),
		);
	const hiddenAlphas = await centerAlphas();
	console.log("all hidden, center alphas:", JSON.stringify(hiddenAlphas));
	check(
		hiddenAlphas[0] === 0 && hiddenAlphas[1] === 0,
		"canvases not empty with all traits hidden",
	);
	// Show one again: it comes back (row 0 is the backdrop, which
	// redraws on its own canvas)
	await rows.nth(0).check();
	await page.waitForTimeout(300);
	const backAlphas = await centerAlphas();
	check(backAlphas[1] !== 0, "re-checked backdrop did not redraw");
	await page.screenshot({ path: "panel-traits.png" });

	// Effects persist: set Motion to 0 and reload. Collapsed
	// sections persist too (docs/tads/burned-traits.md Decision 7):
	// collapse "3D model" before the reload and expect it back
	// collapsed, with the untouched "Effects" still expanded.
	// (Back to the settings drawer for the effects controls.)
	await page.click("#panelHandle");
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
	const sectionState = (title) =>
		page.evaluate((wanted) => {
			const section = [...document.querySelectorAll(".panelSection")].find(
				(s) =>
					s.querySelector(".panelSectionHeader span").textContent === wanted,
			);
			return section ? section.classList.contains("collapsed") : null;
		}, title);
	// Throws a readable error on a missing section instead of an
	// opaque null dereference
	const toggleSection = (title) =>
		page.evaluate((wanted) => {
			const section = [...document.querySelectorAll(".panelSection")].find(
				(s) =>
					s.querySelector(".panelSectionHeader span").textContent === wanted,
			);
			if (!section) {
				throw new Error(`panel section "${wanted}" not found`);
			}
			section.querySelector(".panelSectionHeader").click();
		}, title);
	await toggleSection("3D model");
	check(
		(await sectionState("3D model")) === true,
		"3D model section did not collapse",
	);
	// "How rarity works" defaults to collapsed (operator QA); an
	// explicit expand must override the default across reloads
	check(
		(await sectionState("How rarity works")) === true,
		"rarity explainer did not start collapsed",
	);
	await toggleSection("How rarity works");
	check(
		(await sectionState("How rarity works")) === false,
		"rarity explainer did not expand",
	);
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
	const collapsedAfter = await sectionState("3D model");
	const effectsAfter = await sectionState("Effects");
	console.log(
		`after reload: 3D model collapsed=${collapsedAfter} Effects collapsed=${effectsAfter}`,
	);
	check(collapsedAfter === true, "collapsed section did not survive reload");
	check(effectsAfter === false, "untouched section came back collapsed");
	check(
		(await sectionState("How rarity works")) === false,
		"expanded default-collapsed section reverted after reload",
	);
	check(
		(await sectionState("Overview")) === false,
		"Overview section came back collapsed",
	);
	// Expand it again (and persist that) so the later steps see the
	// section layout they expect
	await toggleSection("3D model");
	check(
		(await sectionState("3D model")) === false,
		"3D model section did not re-expand",
	);

	// In-page token swap resets visibility: hide a trait on the
	// current token, pick a different one through the profile
	// drawer's grid (real finishLoad -> update path, no
	// navigation), and the rebuilt rows must all be checked again
	await page.waitForFunction(
		() => document.querySelectorAll("#profileGrid .profileTile").length === 3,
		{ timeout: 15000 },
	);
	await page.click("#infoHandle");
	await page.locator(".traitRow input").nth(2).uncheck();
	const hiddenBefore = await page.evaluate(
		() =>
			[...document.querySelectorAll(".traitRow input")].filter(
				(box) => !box.checked,
			).length,
	);
	check(hiddenBefore === 1, "precondition: expected 1 hidden row");
	// Switching tabs: the profile drawer replaces the settings
	// column and lazily renders its thumbnails
	await page.click("#profileHandle");
	await page.waitForFunction(
		() => document.querySelectorAll("#profileGrid img").length === 3,
		{ timeout: 20000 },
	);
	await page.locator("#profileGrid .profileTile").nth(1).click();
	// Picking an owned Avastar keeps the drawer OPEN (operator QA
	// 2026-08-28) - browsing the collection continues
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	check(
		await page.evaluate(() =>
			document.getElementById("sidePanel").classList.contains("open"),
		),
		"picking an owned Avastar closed the drawer",
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

	// Tap-outside dismiss (operator QA 2026-08-26): a tap on the
	// scene closes the open drawer; a tap inside a floating modal
	// (which lives OUTSIDE the panel element) must NOT
	const isPanelOpen = () =>
		page.evaluate(() =>
			document.getElementById("sidePanel").classList.contains("open"),
		);
	await page.click("#panelHandle");
	check(await isPanelOpen(), "precondition: settings drawer open");
	await page.mouse.click(100, 100);
	await page.waitForTimeout(200);
	check(!(await isPanelOpen()), "outside tap did not dismiss the drawer");
	await page.route("**/vrm/_status.json", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ total: 26617, fronts: {} }),
		}),
	);
	await page.click("#panelHandle");
	await page.click(".vrmMirrorInfo");
	await page.waitForSelector("#mirrorModal .mirrorHeadline", { timeout: 5000 });
	await page.click("#mirrorModal .mirrorHeadline");
	check(
		await isPanelOpen(),
		"a tap inside the mirror modal dismissed the drawer under it",
	);
	await page.evaluate(() =>
		document.querySelector("#mirrorModal .modalClose").click(),
	);

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
