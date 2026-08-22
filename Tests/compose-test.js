// TAD Step 4 harness: ?traitcompose=1 renders from the committed
// library with no wallet, layers carry trait metadata, and the
// composed full SVG byte-matches the bundled on-chain render.
const { chromium } = require("playwright-core");

(async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
	page.on("console", (m) => {
		if (m.type() === "error") errors.push("console: " + m.text());
		if (m.type() === "warning" && m.text().includes("legacy path"))
			errors.push("FELL BACK: " + m.text());
	});
	page.on("dialog", (d) => { errors.push("dialog: " + d.message()); d.dismiss(); });

	// No wallet, explicit token, composition on
	await page.goto("http://localhost:8741/index.html?tokenid=8014&traitcompose=1");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 }
	);
	await page.waitForTimeout(1200);
	const state = await page.evaluate(async () => {
		const c = document.getElementById("mainCanvas");
		const px = c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1).data;
		// Reach into the scene via a fresh composer for the parity check
		const { default: TraitComposer } = await import("./Lib/TraitComposer.js");
		const composer = new TraitComposer();
		const composed = await composer.compose("8014", { width: 800, height: 600 });
		const bundled = await (await fetch("./SVG/Avastar-8014.svg")).text();
		// The bundled files are pretty-printed saves (indentation +
		// CSS spacing); the chain emits minified. Content parity
		// modulo whitespace is the right harness check - byte parity
		// vs the chain is proven by Tools/validate-composition.js.
		const strip = (s) => s.replace(/\s+/g, "");
		return {
			drawn: px[3] !== 0,
			contentParity: strip(composed.fullSVG) === strip(bundled),
			composedLen: composed.fullSVG.length,
			bundledLen: bundled.length,
			layerCount: composed.layers.length,
			layerNames: composed.layerInfo.map((l) => `${l.geneName}: ${l.name} (${l.rarityName})`),
			backgroundColor: composed.backgroundColor,
		};
	});
	console.log(JSON.stringify(state, null, 1));
	console.log("errors:", errors.length ? errors : "none");

	// Regression: explicit opt-out must keep the legacy path working
	const errors2 = [];
	page.on("pageerror", (e) => errors2.push(e.message));
	await page.goto("http://localhost:8741/index.html?tokenid=8014&traitcompose=0");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 }
	);
	await page.waitForTimeout(800);
	const legacyDrawn = await page.evaluate(() => {
		const c = document.getElementById("mainCanvas");
		return c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1).data[3] !== 0;
	});
	console.log("legacy opt-out drawn:", legacyDrawn, "errors:", errors2.length ? errors2 : "none");

	// Forced failure: library unreachable -> automatic fallback to
	// the legacy path, with the console warn as evidence
	const page3 = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const warns = [];
	const errors3 = [];
	page3.on("pageerror", (e) => errors3.push(e.message));
	page3.on("console", (m) => {
		if (m.type() === "warning" && m.text().includes("legacy path")) warns.push(m.text());
	});
	await page3.route("**/Traits/index.json", (route) => route.abort());
	await page3.goto("http://localhost:8741/index.html?tokenid=8014");
	await page3.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 }
	);
	await page3.waitForTimeout(800);
	const fallbackDrawn = await page3.evaluate(() => {
		const c = document.getElementById("mainCanvas");
		return c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1).data[3] !== 0;
	});
	console.log(
		"forced-failure fallback drawn:", fallbackDrawn,
		"warned:", warns.length > 0,
		"errors:", errors3.length ? errors3 : "none"
	);
	await browser.close();
})();
