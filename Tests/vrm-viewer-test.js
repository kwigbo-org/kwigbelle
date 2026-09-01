// VRM viewer (docs/tads/vrm-viewer.md Step 3, entry points
// reshaped by docs/tads/profile-drawer.md): the panel's "View in
// 3D" button fetches with progress and renders a non-blank WebGL
// canvas, "Back to Vector Avastar" restores the vector view, the byte
// cache makes the second entry instant, a tap on the loading
// overlay cancels, and a token load mid-fetch supersedes the 3D
// entry entirely. All network is routed to a local fixture; the
// fixture itself (the real 8014 model, ~9.3MB) is auto-downloaded
// ONCE into Tests/fixtures/ (gitignored) and reused after - that
// first run needs network.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { check } = require("./check.js");

const FIXTURE_DIR = path.join(__dirname, "fixtures");
const FIXTURE = path.join(FIXTURE_DIR, "Avastar_Prime_8014.vrm");

async function ensureFixture() {
	if (fs.existsSync(FIXTURE)) {
		return;
	}
	console.log("fixture missing - downloading the 8014 model once...");
	const metadata = await (
		await fetch("https://avastars.io/metadata/8014")
	).json();
	const suffix = metadata.vrm_url.match(/\/ipfs\/(.+)$/)[1];
	const gateways = [
		"https://gateway.pinata.cloud/ipfs/",
		"https://ipfs.io/ipfs/",
		"https://dweb.link/ipfs/",
	];
	let lastError = null;
	for (const gateway of gateways) {
		try {
			const response = await fetch(gateway + suffix);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const bytes = Buffer.from(await response.arrayBuffer());
			fs.mkdirSync(FIXTURE_DIR, { recursive: true });
			fs.writeFileSync(FIXTURE, bytes);
			console.log(`fixture saved (${bytes.length} bytes) via ${gateway}`);
			return;
		} catch (error) {
			console.warn(`fixture download failed via ${gateway}: ${error.message}`);
			lastError = error;
		}
	}
	throw new Error(
		"could not download the VRM fixture (network required on the FIRST " +
			"run only; every gateway failed): " +
			lastError.message,
	);
}

(async () => {
	await ensureFixture();
	const model = fs.readFileSync(FIXTURE);

	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
	page.on("dialog", (d) => {
		errors.push("dialog: " + d.message());
		d.dismiss();
	});

	const cors = { "access-control-allow-origin": "*" };
	let gatewayDelay = 0;
	let gatewayHits = 0;
	// The mirror-first lane (docs/tads/vrm-mirror.md) 404s here so
	// the scene falls back to the routed pipeline under test - no
	// real network either way
	await page.route("**/vrm/**", (route) =>
		route.fulfill({ status: 404, headers: cors, body: "not mirrored" }),
	);
	await page.route("**://avastars.io/metadata/**", (route) => {
		route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: cors,
			body: JSON.stringify({
				vrm_url: "https://ipfs.io/ipfs/bafytestcid/Avastar_Prime_8014.vrm",
			}),
		});
	});
	await page.route("**/ipfs/**", async (route) => {
		gatewayHits++;
		if (gatewayDelay > 0) {
			await new Promise((resolve) => setTimeout(resolve, gatewayDelay));
		}
		route.fulfill({
			status: 200,
			contentType: "application/octet-stream",
			headers: cors,
			body: model,
		});
	});

	await page.goto("http://localhost:8741/index.html?tokenid=8014");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.waitForTimeout(500);

	// The 3D canvas renders actual pixels (alpha > 0 somewhere well
	// past a trivial count - preserveDrawingBuffer keeps the frame
	// readable)
	const paintedShare = () =>
		page.evaluate(() => {
			const gl = document.getElementById("vrmCanvas");
			if (!gl) {
				return -1;
			}
			const probe = document.createElement("canvas");
			probe.width = 160;
			probe.height = 120;
			const context = probe.getContext("2d");
			context.drawImage(gl, 0, 0, 160, 120);
			const pixels = context.getImageData(0, 0, 160, 120).data;
			let painted = 0;
			for (let i = 3; i < pixels.length; i += 4) {
				if (pixels[i] > 0) {
					painted++;
				}
			}
			return painted / (pixels.length / 4);
		});

	// The 3D entry point is the panel's "3D model" section now (the
	// floating toggle is retired)
	await page.click("#panelHandle");
	check(
		!(await page.evaluate(() => !!document.getElementById("viewToggle"))),
		"retired floating 3D toggle still present",
	);

	// Enter 3D: fetch, parse, non-blank render
	await page.click(".vrmViewButton");
	await page.waitForSelector("#vrmCanvas", { timeout: 20000 });
	await page.waitForTimeout(1500);
	const share = await paintedShare();
	console.log("painted share:", share, "gateway hits:", gatewayHits);
	check(share > 0.02, "3D canvas is blank (painted share " + share + ")");
	check(gatewayHits === 1, "expected exactly one model fetch");
	const buttonIn3D = await page.locator(".vrmViewButton").innerText();
	check(
		buttonIn3D === "Back to Vector Avastar",
		"section button should read Back to Vector Avastar in 3D mode: " +
			buttonIn3D,
	);
	check(
		!(await page.evaluate(() =>
			document.getElementById("vrmLoading").classList.contains("visible"),
		)),
		"loading overlay still visible after 3D mounted",
	);
	await page.screenshot({ path: "vrm-3d.png" });

	// Back to vector: 3D canvas unmounts, vector canvas draws again
	await page.click(".vrmViewButton");
	await page.waitForFunction(() => !document.getElementById("vrmCanvas"), {
		timeout: 5000,
	});
	await page.waitForTimeout(500);
	const vectorFrame = await page.evaluate(() =>
		document.getElementById("mainCanvas").toDataURL(),
	);
	check(
		vectorFrame.length > 20000,
		"vector canvas did not resume drawing after 3D exit",
	);
	check(
		(await page.locator(".vrmViewButton").innerText()) === "View in 3D",
		"section button should read View in 3D back in vector mode",
	);

	// Second entry comes from the byte cache: no new gateway hit
	await page.click(".vrmViewButton");
	await page.waitForSelector("#vrmCanvas", { timeout: 20000 });
	check(gatewayHits === 1, "cached re-entry refetched the model");
	await page.click(".vrmViewButton");
	await page.waitForFunction(() => !document.getElementById("vrmCanvas"), {
		timeout: 5000,
	});

	// A tap on the loading overlay cancels back to vector (12345 is
	// uncached; the delayed gateway keeps the fetch in flight)
	gatewayDelay = 800;
	await page.fill("#loadTokenInput", "12345");
	await page.press("#loadTokenInput", "Enter");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.waitForTimeout(300);
	await page.click(".vrmViewButton");
	// The center-screen overlay is the load's primary feedback
	await page.waitForFunction(
		() => document.getElementById("vrmLoading").classList.contains("visible"),
		{ timeout: 5000 },
	);
	const overlay = await page.evaluate(() => ({
		text: document.getElementById("vrmLoadingText").innerText,
		hasBar: !!document.getElementById("vrmLoadingBar"),
		hint: document.getElementById("vrmLoadingHint").innerText,
		cancelLabel: document.querySelector(".vrmViewButton").innerText,
	}));
	console.log("loading overlay:", JSON.stringify(overlay));
	check(
		overlay.text.includes("Loading 3D model"),
		"overlay text wrong: " + overlay.text,
	);
	check(overlay.hasBar, "loading overlay has no progress bar");
	check(
		overlay.hint === "Tap to Cancel",
		"overlay cancel hint wrong: " + overlay.hint,
	);
	check(
		overlay.cancelLabel === "Cancel Loading",
		"section button should read Cancel Loading mid-fetch: " +
			overlay.cancelLabel,
	);
	// Cancel by tapping the overlay itself
	await page.click("#vrmLoading");
	await page.waitForTimeout(1500);
	check(
		!(await page.evaluate(() => !!document.getElementById("vrmCanvas"))),
		"cancelled fetch still mounted the 3D view",
	);
	check(
		(await page.locator(".vrmViewButton").innerText()) === "View in 3D",
		"section button not back to View in 3D after cancel",
	);
	check(
		!(await page.evaluate(() =>
			document.getElementById("vrmLoading").classList.contains("visible"),
		)),
		"loading overlay stuck after cancel",
	);

	// A token load mid-fetch supersedes the 3D entry: the stale
	// completion must not mount anything over the new token
	await page.click(".vrmViewButton");
	await page.waitForFunction(
		() => document.getElementById("vrmLoading").classList.contains("visible"),
		{ timeout: 5000 },
	);
	await page.fill("#loadTokenInput", "8014");
	await page.press("#loadTokenInput", "Enter");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.waitForTimeout(1800);
	check(
		!(await page.evaluate(() => !!document.getElementById("vrmCanvas"))),
		"stale 3D fetch mounted over a newer token load",
	);
	check(
		(await page.locator(".vrmViewButton").innerText()) === "View in 3D",
		"section button stuck after a superseding token load",
	);
	check(
		!(await page.evaluate(() =>
			document.getElementById("vrmLoading").classList.contains("visible"),
		)),
		"loading overlay stuck after a superseding token load",
	);

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
