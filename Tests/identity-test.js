// Identity card + rarity icons (docs/tads/design-cues.md Steps
// 1-2): the Traits section leads with token id, kind/series chips,
// score + tier from the verified bands, and a distribution row
// whose counts match the library index; tier icons render in the
// card rows and the edit modal; replicants and promos get their
// kind chips (replicants: no series).
const { chromium } = require("playwright-core");
const { check } = require("./check.js");

(async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
	page.on("dialog", (d) => {
		errors.push("dialog: " + d.message());
		d.dismiss();
	});

	await page.goto("http://localhost:8741/index.html?tokenid=8014");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.waitForTimeout(500);
	await page.click("#panelHandle");

	const readCard = () =>
		page.evaluate(() => ({
			title: document.querySelector(".identityTitle")?.textContent || "",
			chips: [...document.querySelectorAll(".identityChip")].map(
				(c) => c.innerText,
			),
			score: document.querySelector(".identityScore")?.innerText || "",
			dist: [...document.querySelectorAll(".identityDistItem")].map((i) =>
				Number(i.innerText),
			),
			cardIcons: document.querySelectorAll(".identityCard .rarityIcon").length,
			rowIcons: document.querySelectorAll(".traitRow .rarityIcon").length,
		}));

	// 8014: prime, series 2, score 36 -> Uncommon (33-40 band)
	const card = await readCard();
	console.log("8014 card:", JSON.stringify(card));
	check(card.title === "Avastar #8014", "wrong title: " + card.title);
	check(
		card.chips.includes("Prime") && card.chips.includes("Gen 1 · Series 2"),
		"wrong chips: " + JSON.stringify(card.chips),
	);
	check(
		card.score === "Score 36 · Uncommon",
		"wrong score line: " + card.score,
	);
	check(
		card.dist.length === 5 && card.dist.reduce((a, b) => a + b, 0) === 12,
		"distribution does not sum to 12: " + JSON.stringify(card.dist),
	);
	// Distribution counts must match the library index for the picks
	const expectedDist = await page.evaluate(async () => {
		const { default: TraitComposer } = await import("../Lib/TraitComposer.js");
		const composer = new TraitComposer();
		const picks = await composer.picksFor(8014);
		const counts = [0, 0, 0, 0, 0];
		for (const pick of picks) counts[pick.rarity]++;
		return counts;
	});
	check(
		JSON.stringify(card.dist) === JSON.stringify(expectedDist),
		`distribution ${JSON.stringify(card.dist)} != index-derived ${JSON.stringify(expectedDist)}`,
	);
	check(
		card.cardIcons === 6,
		"identity card should carry 6 icons (score + 5 dist): " + card.cardIcons,
	);
	check(card.rowIcons === 12, "every trait card needs a tier icon");

	// Unique-By line fills in async from the frozen table; 8014 is
	// a lottery prime with locally-verified anchors u2=1 / u3=41
	await page.waitForSelector(".identityUB", { timeout: 15000 });
	const ubLine = await page.evaluate(() => ({
		line: document.querySelector(".identityUB")?.innerText || "",
		note: document.querySelector(".identityUBNote")?.innerText || "",
	}));
	console.log("UB:", JSON.stringify(ubLine));
	check(
		ubLine.line === "Unique-By combos: 2-trait 1 · 3-trait 41",
		"wrong UB line: " + ubLine.line,
	);
	check(
		ubLine.note.includes("Series 1-5 primes"),
		"UB qualifier missing: " + ubLine.note,
	);

	// Modal option tiles carry icons too
	await page.locator(".traitRow .traitEdit").last().click();
	await page.waitForSelector("#traitModal .modalOption", { timeout: 15000 });
	const modalIcons = await page.evaluate(
		() =>
			document.querySelectorAll("#traitModal .modalOption .rarityIcon").length,
	);
	check(modalIcons > 0, "modal options have no tier icons");
	await page.click(".modalClose");
	await page.waitForFunction(() => !document.getElementById("traitModal"), {
		timeout: 5000,
	});

	// Override keeps the TOKEN's score/series; distribution follows
	// the displayed traits; undo restores the original counts
	await page.locator(".traitRow .traitEdit").last().click();
	await page.waitForSelector("#traitModal .modalOption", { timeout: 15000 });
	await page.locator(".modalOption:not(.current)").first().click();
	await page.waitForFunction(
		() => document.querySelectorAll(".traitUndo").length === 1,
		{ timeout: 15000 },
	);
	const overridden = await readCard();
	check(
		overridden.score === "Score 36 · Uncommon" &&
			overridden.chips.includes("Gen 1 · Series 2"),
		"override changed the token's identity: " + JSON.stringify(overridden),
	);
	check(
		overridden.dist.reduce((a, b) => a + b, 0) === 12,
		"overridden distribution does not sum to 12",
	);
	await page.locator(".traitUndo").click();
	await page.waitForFunction(
		() => document.querySelectorAll(".traitUndo").length === 0,
		{ timeout: 15000 },
	);
	const undone = await readCard();
	check(
		JSON.stringify(undone.dist) === JSON.stringify(card.dist),
		"undo did not restore the distribution",
	);

	// Replicant: kind chip, NO series chip, own score (25500 -> 61
	// Legendary band)
	await page.fill("#loadTokenInput", "25500");
	await page.press("#loadTokenInput", "Enter");
	await page.waitForFunction(
		() =>
			document.querySelector(".identityTitle")?.textContent ===
			"Avastar #25500",
		{ timeout: 15000 },
	);
	const replicant = await readCard();
	console.log("25500 card:", JSON.stringify(replicant));
	check(
		replicant.chips.includes("Replicant"),
		"replicant chip missing: " + JSON.stringify(replicant.chips),
	);
	check(
		!replicant.chips.some((c) => c.includes("Series")),
		"replicant shows a series chip",
	);
	check(
		replicant.score === "Score 61 · Legendary",
		"wrong replicant score line: " + replicant.score,
	);
	// Replicants did not play the mint lottery: no Unique-By line
	// (table already cached in-page, so no async wait needed beyond
	// this settle)
	await page.waitForTimeout(600);
	check(
		!(await page.evaluate(() => !!document.querySelector(".identityUB"))),
		"replicant shows a Unique-By line",
	);

	// Founder: promo kind chip + Series 0 (token 50 -> score 62)
	await page.fill("#loadTokenInput", "50");
	await page.press("#loadTokenInput", "Enter");
	await page.waitForFunction(
		() =>
			document.querySelector(".identityTitle")?.textContent === "Avastar #50",
		{ timeout: 15000 },
	);
	const founder = await readCard();
	console.log("50 card:", JSON.stringify(founder));
	check(
		founder.chips.includes("Founder") &&
			founder.chips.includes("Gen 1 · Series 0"),
		"founder chips wrong: " + JSON.stringify(founder.chips),
	);
	check(
		founder.score === "Score 62 · Legendary",
		"wrong founder score line: " + founder.score,
	);
	await page.waitForTimeout(600);
	check(
		!(await page.evaluate(() => !!document.querySelector(".identityUB"))),
		"founder shows a Unique-By line (hand-picked traits, no lottery)",
	);

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
