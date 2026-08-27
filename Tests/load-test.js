// Load Avastar section (docs/tads/avastar-lab.md Steps 1-2):
// walletless load of an arbitrary token id from the panel, inline
// validation for bad ids, Enter-key submit, and the composer split
// (picksFor + composePicks) preserving compose() output.
const { chromium } = require("playwright-core");
const { check } = require("./check.js");

(async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	// No wallet mock at all: the section must work fully logged out
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

	// Start from a KNOWN token so the "different token" assertion is
	// deterministic (no random bundled pick)
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
	await page.waitForTimeout(800);
	await page.click("#panelHandle");

	// Composer split: picksFor matches compose's traits, and
	// composePicks(picksFor(id)) reproduces compose(id)'s fullSVG
	const split = await page.evaluate(async () => {
		const { default: TraitComposer } = await import("./Lib/TraitComposer.js");
		const composer = new TraitComposer();
		const size = { width: 400, height: 300 };
		const picks = await composer.picksFor("8014");
		const viaPicks = await composer.composePicks(picks, size);
		const viaToken = await composer.compose("8014", size);
		const hairStyles = await composer.traitsForGene(11);
		return {
			pickCount: picks.length,
			sameSVG: viaPicks.fullSVG === viaToken.fullSVG,
			wrapperTokenId: viaToken.tokenId,
			picksTokenId: viaPicks.tokenId,
			hasKnown: await composer.hasToken("8014"),
			hasUnknown: await composer.hasToken("999999"),
			hairStyleCount: hairStyles.length,
			hairStylesSorted: hairStyles.every(
				(t, i) => i === 0 || t.variation >= hairStyles[i - 1].variation,
			),
		};
	});
	console.log("composer split:", JSON.stringify(split));
	check(split.pickCount === 12, "picksFor did not return 12 records");
	check(split.sameSVG, "composePicks(picksFor) != compose fullSVG");
	check(split.wrapperTokenId === "8014", "compose wrapper lost tokenId");
	check(split.picksTokenId === null, "composePicks should carry no tokenId");
	check(split.hasKnown && !split.hasUnknown, "hasToken membership wrong");
	check(split.hairStyleCount > 0, "traitsForGene(11) empty");
	check(split.hairStylesSorted, "traitsForGene not variation-sorted");

	// Invalid ids: inline error, no load started
	const submit = async (value) => {
		await page.fill("#loadTokenInput", value);
		await page.click(".loadButton");
		await page.waitForTimeout(400);
		return page.evaluate(() => ({
			error: document.querySelector(".loadError").innerText,
			preloader: document.getElementById("preloader").style.opacity,
		}));
	};
	const junk = await submit("abc");
	check(
		junk.error.includes("numeric"),
		"non-numeric id not rejected: " + junk.error,
	);
	const unknown = await submit("999999");
	check(
		unknown.error.includes("999999"),
		"unknown id not rejected: " + unknown.error,
	);
	check(unknown.preloader === "0", "a doomed load was started");

	// Valid id via Enter key: loads walletless, traits rebuild
	const nameBefore = await page.evaluate(
		() => document.querySelector(".traitValue").innerText,
	);
	await page.fill("#loadTokenInput", "12345");
	await page.press("#loadTokenInput", "Enter");
	// Converge on the actual signal - the trait sheet rebuilding for
	// the new token - not on preloader state, which is already "0"
	// from the previous load before selectAvastar even fires
	await page.waitForFunction(
		(before) => {
			const value = document.querySelector(".traitValue");
			const preloader = document.getElementById("preloader").style.opacity;
			return value && value.innerText !== before && preloader === "0";
		},
		nameBefore,
		{ timeout: 15000 },
	);
	await page.waitForTimeout(300);
	const after = await page.evaluate(() => ({
		firstTrait: document.querySelector(".traitValue").innerText,
		rowCount: document.querySelectorAll(".traitRow").length,
		drawn: (() => {
			const c = document.getElementById("mainCanvas");
			return (
				c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1)
					.data[3] !== 0
			);
		})(),
	}));
	console.log(
		"loaded 12345:",
		JSON.stringify(after),
		"(was:",
		JSON.stringify(nameBefore) + ")",
	);
	check(after.drawn, "loaded Avastar not drawn");
	check(after.rowCount === 12, "trait rows not rebuilt for the loaded token");
	check(
		after.firstTrait !== nameBefore,
		"traits did not change after loading a different token",
	);

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
