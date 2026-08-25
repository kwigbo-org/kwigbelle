// 3D-mode settings limits + owner download (docs/tads/
// vrm-viewer.md Step 4): the "3D model" section's button enters
// 3D, Effects hides, Traits goes read-only (controls gone, note
// shown), a trait override survives the 3D round-trip with
// byte-identical pixels, and Download VRM appears only when the
// mocked wallet owns the displayed token and saves the original
// filename. Requires the vrm-viewer-test fixture (auto-downloads
// if missing on a networked machine).
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { check } = require("./check.js");

const FIXTURE = path.join(__dirname, "fixtures", "Avastar_Prime_8014.vrm");

// The wallet owns 8014: with ?tokenid=8014 the displayed token is
// owned, so the download gate should open once the silent
// enumeration lands
const MOCK_PROVIDER = `
window.__ownedIds = [8014, 25495];
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

async function launch(withWallet) {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
	page.on("dialog", (d) => {
		errors.push("dialog: " + d.message());
		d.dismiss();
	});
	if (withWallet) {
		await page.addInitScript(MOCK_PROVIDER);
	}
	const model = fs.readFileSync(FIXTURE);
	const cors = { "access-control-allow-origin": "*" };
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
	await page.route("**/ipfs/**", (route) => {
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
	await page.click("#panelHandle");
	return { browser, page, errors };
}

(async () => {
	check(
		fs.existsSync(FIXTURE),
		"fixture missing - run vrm-viewer-test.js first (it downloads it)",
	);

	// ---- Walletless: no download button, limits apply in 3D ----
	{
		const { browser, page, errors } = await launch(false);
		check(
			(await page.locator(".vrmDownload").count()) === 1 &&
				!(await page.locator(".vrmDownload").isVisible()),
			"download button visible without a wallet",
		);

		// Freeze motion so the override round-trip compares frames
		await page
			.locator(".effectRow", { hasText: "Pause motion" })
			.locator("input")
			.check();
		await page.waitForTimeout(300);

		// Apply a trait override (last card = hair style). The trait
		// cards live in the info drawer (docs/tads/info-tab.md).
		const frame = () =>
			page.evaluate(() => document.getElementById("mainCanvas").toDataURL());
		await page.click("#infoHandle");
		await page.locator(".traitRow .traitEdit").last().click();
		await page.waitForSelector("#traitModal .modalOption", { timeout: 15000 });
		await page.locator(".modalOption:not(.current)").first().click();
		await page.waitForFunction(
			() => document.querySelectorAll(".traitUndo").length === 1,
			{ timeout: 15000 },
		);
		await page.waitForTimeout(500);
		const overriddenFrame = await frame();

		// 3D keeps the SAME background as the vector view (Decision 6
		// revised by operator QA): the token color on contentView and
		// the backdrop art on its own canvas, behind the VRM
		const contentBg = () =>
			page.evaluate(
				() =>
					window.getComputedStyle(document.getElementById("contentView"))
						.backgroundColor,
			);
		const backdropCorner = () =>
			page.evaluate(
				() =>
					document
						.getElementById("backdropCanvas")
						.getContext("2d")
						.getImageData(10, 10, 1, 1).data[3],
			);
		const tokenBg = await contentBg();
		check(
			(await backdropCorner()) === 255,
			"precondition: backdrop art not painted before 3D",
		);

		// Enter 3D through the SECTION button (the floating toggle's
		// twin) and verify the limited settings
		await page.click("#panelHandle");
		await page.locator(".vrmViewButton").click();
		await page.waitForSelector("#vrmCanvas", { timeout: 20000 });
		await page.waitForTimeout(500);

		const bg3D = await contentBg();
		check(
			bg3D === tokenBg,
			`3D changed the page background: ${bg3D} != ${tokenBg}`,
		);
		check(
			(await backdropCorner()) === 255,
			"backdrop art not visible behind the 3D view",
		);

		// Resize while 3D is up: assigning canvas dimensions blanks
		// the bitmap and the paused 2D loop can't repaint - resize()
		// must (round-4 review, all four panelists)
		await page.setViewportSize({ width: 700, height: 520 });
		await page.waitForTimeout(400);
		check(
			(await backdropCorner()) === 255,
			"backdrop art lost after resizing during 3D",
		);
		await page.setViewportSize({ width: 800, height: 600 });
		await page.waitForTimeout(400);
		const limits = await page.evaluate(() => {
			const sections = [...document.querySelectorAll(".panelSection")];
			const effects = sections.find(
				(s) =>
					s.querySelector(".panelSectionHeader span").textContent === "Effects",
			);
			return {
				effectsHidden: effects.style.display === "none",
				checkboxes: document.querySelectorAll(".traitRow input").length,
				editButtons: document.querySelectorAll(".traitEdit").length,
				undoButtons: document.querySelectorAll(".traitUndo").length,
				noteShown: [...document.querySelectorAll(".traitNote")].some((n) =>
					n.innerText.includes("original on-chain Avastar"),
				),
				cardCount: document.querySelectorAll(".traitRow").length,
				viewButton: document.querySelector(".vrmViewButton").innerText,
			};
		});
		console.log("3D limits:", JSON.stringify(limits));
		check(limits.effectsHidden, "Effects section still visible in 3D");
		check(limits.checkboxes === 0, "visibility checkboxes present in 3D");
		check(limits.editButtons === 0, "edit buttons present in 3D");
		check(limits.undoButtons === 0, "undo shown in read-only 3D cards");
		check(limits.noteShown, "read-only note missing in 3D");
		check(limits.cardCount === 12, "expected all 12 baseline cards in 3D");
		check(
			limits.viewButton === "Back to vector",
			"section button label wrong in 3D",
		);

		// Round-trip: everything returns, override intact,
		// byte-identical pixels
		await page.locator(".vrmViewButton").click();
		await page.waitForFunction(() => !document.getElementById("vrmCanvas"), {
			timeout: 5000,
		});
		await page.waitForTimeout(500);
		const restored = await page.evaluate(() => {
			const sections = [...document.querySelectorAll(".panelSection")];
			const effects = sections.find(
				(s) =>
					s.querySelector(".panelSectionHeader span").textContent === "Effects",
			);
			return {
				effectsVisible: effects.style.display !== "none",
				undoButtons: document.querySelectorAll(".traitUndo").length,
				editButtons: document.querySelectorAll(".traitEdit").length,
			};
		});
		check(restored.effectsVisible, "Effects did not return after 3D");
		check(restored.undoButtons === 1, "override lost across the 3D round-trip");
		check(restored.editButtons > 0, "edit buttons did not return");
		const bgRestored = await contentBg();
		check(
			bgRestored === tokenBg,
			`token background not restored after 3D: ${bgRestored} != ${tokenBg}`,
		);
		check(
			(await frame()) === overriddenFrame,
			"vector pixels changed across the 3D round-trip",
		);

		console.log("walletless errors:", errors.length ? errors : "none");
		check(errors.length === 0, "page errors: " + JSON.stringify(errors));
		await browser.close();
	}

	// ---- Wallet owns 8014: download appears and saves the file ----
	{
		const { browser, page, errors } = await launch(true);
		await page.waitForFunction(
			() => {
				const button = document.querySelector(".vrmDownload");
				return button && button.style.display !== "none";
			},
			{ timeout: 15000 },
		);
		const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
		await page.locator(".vrmDownload").click();
		const download = await downloadPromise;
		console.log("download filename:", download.suggestedFilename());
		check(
			download.suggestedFilename() === "Avastar_Prime_8014.vrm",
			"wrong download filename: " + download.suggestedFilename(),
		);
		await download.cancel().catch(() => {});

		// An unowned token hides the button again
		await page.fill("#loadTokenInput", "12345");
		await page.press("#loadTokenInput", "Enter");
		await page.waitForFunction(
			() => {
				const button = document.querySelector(".vrmDownload");
				return (
					document.getElementById("preloader")?.style.opacity === "0" &&
					button.style.display === "none"
				);
			},
			{ timeout: 15000 },
		);

		console.log("wallet errors:", errors.length ? errors : "none");
		check(errors.length === 0, "page errors: " + JSON.stringify(errors));
		await browser.close();
	}

	console.log("vrm-panel-test complete");
})();
