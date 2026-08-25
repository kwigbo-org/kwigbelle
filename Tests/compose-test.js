// Trait composition harness: the site renders from the committed
// library with no wallet, layers carry trait metadata, the composed
// full SVG content-matches the bundled on-chain render, and a
// library failure degrades to the single-static-layer fallback
// (docs/tads/retire-legacy.md) instead of a dead preloader.
const { chromium } = require("playwright-core");
const { check } = require("./check.js");

(async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
	page.on("console", (m) => {
		if (m.type() === "error") errors.push("console: " + m.text());
		if (m.type() === "warning" && m.text().includes("static fallback"))
			errors.push("FELL BACK: " + m.text());
	});
	page.on("dialog", (d) => {
		errors.push("dialog: " + d.message());
		d.dismiss();
	});

	// No wallet, explicit token
	await page.goto("http://localhost:8741/index.html?tokenid=8014");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.waitForTimeout(1200);
	const state = await page.evaluate(async () => {
		const c = document.getElementById("mainCanvas");
		const px = c
			.getContext("2d")
			.getImageData(c.width / 2, c.height / 2, 1, 1).data;
		// Reach into the scene via a fresh composer for the parity check
		const { default: TraitComposer } = await import("./Lib/TraitComposer.js");
		const composer = new TraitComposer();
		const composed = await composer.compose("8014", {
			width: 800,
			height: 600,
		});
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
			layerNames: composed.layerInfo.map(
				(l) => `${l.geneName}: ${l.name} (${l.rarityName})`,
			),
			backgroundColor: composed.backgroundColor,
		};
	});
	console.log(JSON.stringify(state, null, 1));
	console.log("errors:", errors.length ? errors : "none");
	check(state.drawn, "composed avatar not drawn");
	check(state.contentParity, "composed SVG does not match bundled render");
	check(state.layerCount > 0, "no composed layers");
	check(
		state.layerNames.length === state.layerCount,
		"layerInfo/layers length mismatch",
	);
	check(!!state.backgroundColor, "no background color extracted");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));

	// Mobile viewport: the backdrop rasterizes AT the display size
	// with cover semantics (docs/tads/info-tab.md Decision 7) - the
	// old 100%-sized meet raster got stretched by drawImage,
	// squishing the square art on tall phones. Captured SVG headers
	// prove the aspect mode; the natural-size match proves drawImage
	// isn't re-stretching.
	const pageM = await browser.newPage({
		viewport: { width: 390, height: 844 },
	});
	const errorsM = [];
	pageM.on("pageerror", (e) => errorsM.push(e.message));
	pageM.on("dialog", (d) => {
		errorsM.push("dialog: " + d.message());
		d.dismiss();
	});
	await pageM.addInitScript(() => {
		const origCreate = URL.createObjectURL.bind(URL);
		window.__svgHeads = [];
		URL.createObjectURL = (blob) => {
			if (blob && blob.type === "image/svg+xml") {
				blob
					.text()
					.then((t) => window.__svgHeads.push(t.slice(0, t.indexOf(">") + 1)));
			}
			return origCreate(blob);
		};
	});
	await pageM.goto("http://localhost:8741/index.html?tokenid=8014&testharness");
	await pageM.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await pageM.waitForTimeout(800);
	const mobile = await pageM.evaluate(() => {
		const scene = window.kwigbelleScene;
		const bg = scene.avastar.backgroundLayer;
		return {
			canvas: { w: scene.canvas.width, h: scene.canvas.height },
			bgNatural: { w: bg.naturalWidth, h: bg.naturalHeight },
			heads: window.__svgHeads,
		};
	});
	console.log(
		"mobile canvas:",
		JSON.stringify(mobile.canvas),
		"backdrop natural:",
		JSON.stringify(mobile.bgNatural),
	);
	check(
		mobile.canvas.w === 390 && mobile.canvas.h === 844,
		"mobile canvas not viewport-sized: " + JSON.stringify(mobile.canvas),
	);
	check(
		mobile.bgNatural.w === mobile.canvas.w &&
			mobile.bgNatural.h === mobile.canvas.h,
		"backdrop not rasterized at the display size (drawImage would stretch): " +
			JSON.stringify(mobile.bgNatural),
	);
	const layerHeads = mobile.heads.filter((h) =>
		h.includes('viewBox="0 0 1000 1000"'),
	);
	const sliceHeads = layerHeads.filter((h) => h.includes('"xMidYMid slice"'));
	const meetHeads = layerHeads.filter((h) => h.includes('"xMidYMid meet"'));
	console.log(
		"layer headers:",
		layerHeads.length,
		"slice:",
		sliceHeads.length,
		"meet:",
		meetHeads.length,
	);
	check(
		sliceHeads.length === 1 &&
			sliceHeads[0].includes('width="390"') &&
			sliceHeads[0].includes('height="844"'),
		"expected exactly the backdrop to cover (slice) at viewport size: " +
			JSON.stringify(sliceHeads),
	);
	check(
		meetHeads.length === layerHeads.length - 1,
		"trait layers must keep letterbox (meet) semantics",
	);
	check(errorsM.length === 0, "mobile page errors: " + JSON.stringify(errorsM));
	await pageM.close();

	// Forced failure: library unreachable -> single static layer
	// fallback, with the console warn as evidence
	const page3 = await browser.newPage({
		viewport: { width: 800, height: 600 },
	});
	const warns = [];
	const errors3 = [];
	page3.on("pageerror", (e) => errors3.push(e.message));
	page3.on("console", (m) => {
		if (m.type() === "warning" && m.text().includes("static fallback"))
			warns.push(m.text());
	});
	page3.on("dialog", (d) => {
		errors3.push("dialog: " + d.message());
		d.dismiss();
	});
	await page3.route("**/Traits/index.json", (route) => route.abort());
	await page3.goto("http://localhost:8741/index.html?tokenid=8014");
	await page3.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page3.waitForTimeout(800);
	const fallback = await page3.evaluate(() => {
		const c = document.getElementById("mainCanvas");
		return {
			drawn:
				c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1)
					.data[3] !== 0,
		};
	});
	console.log(
		"forced-failure static fallback drawn:",
		fallback.drawn,
		"warned:",
		warns.length > 0,
		"errors:",
		errors3.length ? errors3 : "none",
	);
	check(fallback.drawn, "static fallback did not draw");
	check(warns.length > 0, "fallback happened without the static-fallback warn");
	check(
		errors3.length === 0,
		"fallback page errors: " + JSON.stringify(errors3),
	);
	await browser.close();
})();
