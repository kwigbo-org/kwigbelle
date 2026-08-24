// Profile drawer grid (docs/tads/profile-drawer.md): the owned
// Avastars live in the profile drawer now — the old floating picker
// is gone. Silent connect builds the grid and lights the handle
// badge; opening the drawer loads thumbnails lazily; picking a tile
// loads that token, closes the drawer, and moves the highlight.
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
		{ timeout: 15000 },
	);
	// The silent wallet flow builds the grid (no drawer interaction
	// needed) and auto-swaps to the first owned Avastar
	// (the display starts on a random bundled token, so the
	// highlight settles on 8014 only once the silent swap lands)
	await page.waitForFunction(
		() =>
			document.querySelectorAll("#profileGrid .profileTile").length === 3 &&
			document.getElementById("preloader")?.style.opacity === "0" &&
			document.querySelector(".profileTile.current")?.dataset.token === "8014",
		{ timeout: 20000 },
	);

	const closed = await page.evaluate(() => ({
		oldPicker: !!document.getElementById("avastarPicker"),
		drawerOpen: document.getElementById("sidePanel").classList.contains("open"),
		badge: document
			.getElementById("profileHandle")
			.classList.contains("connected"),
		// Lazy thumbnails: no wallet renders before the drawer opens
		thumbs: document.querySelectorAll("#profileGrid img").length,
		currentLabel: document.querySelector(".profileTile.current").dataset.token,
	}));
	console.log("before open:", JSON.stringify(closed));
	check(!closed.oldPicker, "retired floating picker still present");
	check(!closed.drawerOpen, "drawer open before any tap");
	check(closed.badge, "profile handle badge not lit after silent connect");
	check(closed.thumbs === 0, "thumbnails rendered before the drawer opened");
	check(
		closed.currentLabel === "8014",
		"current highlight not on the first owned token: " + closed.currentLabel,
	);

	// Open the profile drawer: thumbnails render in
	await page.click("#profileHandle");
	const opened = await page.evaluate(() => ({
		drawerOpen: document.getElementById("sidePanel").classList.contains("open"),
		profileActive: document
			.getElementById("profileHandle")
			.classList.contains("active"),
	}));
	check(opened.drawerOpen, "profile handle did not open the drawer");
	check(opened.profileActive, "profile handle not marked active");
	await page.waitForFunction(
		() => document.querySelectorAll("#profileGrid img").length === 3,
		{ timeout: 15000 },
	);
	const address = await page.evaluate(
		() => document.getElementById("profileAddress")?.innerText,
	);
	console.log("address line:", JSON.stringify(address));
	check(
		!!address && address.includes("…"),
		"connected address line missing: " + address,
	);
	await page.screenshot({ path: "profile-open.png" });

	// Pick the second Avastar: loads it, closes the drawer, moves
	// the highlight
	await page.locator("#profileGrid .profileTile").nth(1).click();
	await page.waitForFunction(
		() =>
			!document.getElementById("sidePanel").classList.contains("open") &&
			document.getElementById("preloader")?.style.opacity === "0" &&
			document.querySelector(".profileTile.current")?.dataset.token !== "8014",
		{ timeout: 15000 },
	);
	await page.waitForTimeout(500);
	const picked = await page.evaluate(() => ({
		current: document.querySelector(".profileTile.current")?.dataset.token,
		currents: document.querySelectorAll(".profileTile.current").length,
	}));
	console.log("picked:", JSON.stringify(picked));
	check(
		picked.current === "25495",
		"highlight did not move to the picked token: " + picked.current,
	);
	check(picked.currents === 1, "more than one tile highlighted");
	await page.screenshot({ path: "profile-picked.png" });

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
