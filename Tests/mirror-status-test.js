// Mirror status modal (docs/tads/vrm-mirror.md Decision 10): the
// "3D model" section's info button opens a modal that fetches the
// capture-published vrm/_status.json (same-origin - the mirror
// lives in the site's bucket), sums the two-front progress, and
// renders bar + counts; an unpublished status renders the quiet
// fallback instead. Walletless, no VRM fetch involved.
const { chromium } = require("playwright-core");
const { check } = require("./check.js");

const STATUS = {
	total: 26617,
	updated: new Date().toISOString(),
	fronts: {
		"0-14000": {
			from: 0,
			until: 14000,
			captured: 900,
			// Gaps must NOT count toward "models backed up"
			gaps: 10,
			bytes: 9e9,
			updated: new Date().toISOString(),
		},
		"14000-26617": {
			from: 14000,
			until: 26617,
			captured: 100,
			gaps: 0,
			bytes: 1e9,
			updated: new Date(Date.now() - 5 * 60000).toISOString(),
		},
	},
};

(async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
	page.on("dialog", (d) => {
		errors.push("dialog: " + d.message());
		d.dismiss();
	});

	let statusAvailable = true;
	await page.route("**/vrm/_status.json", (route) => {
		if (!statusAvailable) {
			route.fulfill({ status: 404, body: "not found" });
			return;
		}
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(STATUS),
		});
	});
	// The per-token backup indicator HEADs vrm/<file>: 8014 is in
	// the mirror, everything else is pending
	await page.route("https://kwigbelle.com/vrm/Avastar_*.vrm", (route) => {
		route.fulfill({
			status: route.request().url().includes("Avastar_Prime_8014.vrm")
				? 200
				: 404,
			body: "",
		});
	});

	await page.goto("http://localhost:8741/index.html?tokenid=8014");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.waitForTimeout(300);

	// Backup indicator: 8014 is mirrored (green), a token whose HEAD
	// 404s shows pending (red); the row lives in the 3D model section
	await page.click("#panelHandle");
	await page.waitForFunction(
		() => document.querySelector(".vrmBackupText")?.innerText === "Backed Up",
		{ timeout: 5000 },
	);
	check(
		await page.evaluate(() =>
			document.querySelector(".vrmBackupDot").classList.contains("backed"),
		),
		"mirrored token's dot is not green",
	);
	await page.fill("#loadTokenInput", "12345");
	await page.press("#loadTokenInput", "Enter");
	await page.waitForFunction(
		() =>
			document.querySelector(".vrmBackupText")?.innerText === "Pending Backup",
		{ timeout: 15000 },
	);
	check(
		await page.evaluate(() =>
			document.querySelector(".vrmBackupDot").classList.contains("pending"),
		),
		"unmirrored token's dot is not red",
	);
	await page.fill("#loadTokenInput", "8014");
	await page.press("#loadTokenInput", "Enter");
	await page.waitForFunction(
		() => document.querySelector(".vrmBackupText")?.innerText === "Backed Up",
		{ timeout: 15000 },
	);

	// Open the info modal and read it
	await page.click(".vrmMirrorInfo");
	await page.waitForSelector("#mirrorModal .mirrorHeadline", {
		timeout: 5000,
	});
	const modal = await page.evaluate(() => ({
		title: document.querySelector("#mirrorModal .modalTitle").innerText,
		headline: document.querySelector("#mirrorModal .mirrorHeadline").innerText,
		details: [...document.querySelectorAll("#mirrorModal .mirrorDetail")].map(
			(element) => element.innerText,
		),
		frontLines: document.querySelectorAll("#mirrorModal .mirrorFront").length,
		knownTitle: document.querySelector("#mirrorModal .mirrorKnownTitle")
			?.innerText,
		knownRanges: [
			...document.querySelectorAll("#mirrorModal .mirrorKnownRange"),
		].map((element) => element.innerText),
		knownReasons: [
			...document.querySelectorAll("#mirrorModal .mirrorKnownReason"),
		].map((element) => element.innerText),
		barWidth: document.querySelector("#mirrorModal .mirrorBarFill").style.width,
	}));
	console.log("modal:", JSON.stringify(modal, null, 1));
	// .modalTitle renders uppercase via CSS
	check(modal.title === "VRM BACKUP", "modal title wrong: " + modal.title);
	// 1,000/26,617 = 3.8% - the 10 gaps must not inflate the percent
	check(
		modal.headline.includes("1,000 of 26,617") &&
			modal.headline.includes("(3.8%)"),
		"headline wrong: " + modal.headline,
	);
	check(
		modal.details[0] === "10.00 GB safely mirrored",
		"GB line wrong: " + modal.details[0],
	);
	// The published gap count must NOT render its own line (operator
	// QA 2026-08-31): the Known missing section below names the same
	// tokens with ranges and reasons - the fixture's gaps:10 exists
	// to prove both that the percent ignores it AND that no gaps
	// line appears
	check(
		modal.details.length === 1,
		"unexpected extra detail line: " + JSON.stringify(modal.details),
	);
	// Per-front capture-machine lines removed (operator QA
	// 2026-08-31): the fixture's fronts still feed the sums, but no
	// per-machine rows render
	check(
		modal.frontLines === 0,
		"per-front lines still render: " + modal.frontLines,
	);
	check(modal.barWidth === "3.8%", "bar width wrong: " + modal.barWidth);
	// Known-missing blocks (operator request 2026-08-31): the two
	// unmirrorable ranges render with counts and reasons
	// .mirrorKnownTitle renders uppercase via CSS
	check(
		modal.knownTitle === "KNOWN MISSING",
		"known-missing title wrong: " + modal.knownTitle,
	);
	check(
		modal.knownRanges.length === 2 && modal.knownReasons.length === 2,
		"expected two known-missing range+reason pairs",
	);
	// The mint-number ranges are the headline (operator direction:
	// readable at a glance), reasons beneath
	check(
		modal.knownRanges[0] === "#23,000 – #23,199 · 200 tokens",
		"404-block range wrong: " + modal.knownRanges[0],
	);
	check(
		modal.knownReasons[0].includes("Missing from the IPFS source"),
		"404-block reason wrong: " + modal.knownReasons[0],
	);
	check(
		modal.knownRanges[1] === "#26,530 – #26,616 · 87 tokens",
		"never-generated range wrong: " + modal.knownRanges[1],
	);
	check(
		modal.knownReasons[1].includes("never generated"),
		"never-generated reason wrong: " + modal.knownReasons[1],
	);

	// A second tap while open must not stack overlays
	await page.click(".vrmMirrorInfo").catch(() => {});
	check(
		(await page.locator("#mirrorModal").count()) === 1,
		"info tap stacked a second modal",
	);

	// Backdrop tap dismisses
	await page.mouse.click(10, 10);
	await page.waitForFunction(() => !document.getElementById("mirrorModal"), {
		timeout: 3000,
	});

	// Unpublished status: the quiet fallback, no page errors
	statusAvailable = false;
	await page.click(".vrmMirrorInfo");
	await page.waitForFunction(
		() =>
			document
				.querySelector("#mirrorModal .mirrorBody")
				?.innerText.includes("isn't published yet"),
		{ timeout: 5000 },
	);
	await page.evaluate(() =>
		document.querySelector("#mirrorModal .modalClose").click(),
	);
	await page.waitForFunction(() => !document.getElementById("mirrorModal"), {
		timeout: 3000,
	});

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
	console.log("mirror-status-test complete");
})();
