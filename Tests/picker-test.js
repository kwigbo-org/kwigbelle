const { chromium } = require("playwright-core");
const { check } = require("./check.js");

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

	await page.goto("http://localhost:8741/index.html");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 }
	);
	// Wait for the background wallet flow: picker built, auto-swap
	// to the first owned Avastar done (thumbnail image present)
	await page.waitForSelector(".pickerThumb.current img", { timeout: 15000 });

	// Thumbnail present, showing the first owned token, list collapsed
	const collapsed = await page.evaluate(() => ({
		hasPicker: !!document.getElementById("avastarPicker"),
		thumbHasImg: !!document.querySelector(".pickerThumb.current img"),
		listVisible: document
			.getElementById("pickerList")
			.classList.contains("expanded"),
		itemCount: document.querySelectorAll("#pickerList .pickerThumb").length,
	}));
	console.log("collapsed state:", JSON.stringify(collapsed));
	check(collapsed.hasPicker, "picker not built");
	check(collapsed.thumbHasImg, "current thumbnail has no image");
	check(!collapsed.listVisible, "picker list expanded before any tap");
	check(collapsed.itemCount === 3, "expected 3 owned items, got " + collapsed.itemCount);
	await page.screenshot({ path: "picker-collapsed.png" });

	// Expand: all three owned Avastars listed, thumbnails render in
	await page.click(".pickerThumb.current");
	await page.waitForFunction(
		() => document.querySelectorAll("#pickerList img").length === 3,
		{ timeout: 15000 }
	);
	await page.screenshot({ path: "picker-expanded.png" });

	// Pick the second Avastar: loads it and collapses the list. The
	// collapsed thumbnail is rebuilt with a fresh blob URL only when a
	// load actually completes (the same-token guard skips the rebuild),
	// so a changed img src is the evidence the pick took effect.
	const thumbSrcBefore = await page.evaluate(
		() => document.querySelector(".pickerThumb.current img").src
	);
	await page
		.locator("#pickerList .pickerThumb")
		.nth(1)
		.click();
	await page.waitForFunction(
		() =>
			!document
				.getElementById("pickerList")
				.classList.contains("expanded") &&
			document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 }
	);
	await page.waitForTimeout(800);
	const thumbSrcAfter = await page.evaluate(
		() => document.querySelector(".pickerThumb.current img").src
	);
	console.log("pick reloaded thumbnail:", thumbSrcAfter !== thumbSrcBefore);
	check(
		thumbSrcAfter !== thumbSrcBefore,
		"picking the second Avastar did not reload the current thumbnail"
	);
	await page.screenshot({ path: "picker-picked.png" });

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
