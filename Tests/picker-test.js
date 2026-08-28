// Profile drawer grid (docs/tads/profile-drawer.md): the owned
// Avastars live in the profile drawer now — the old floating picker
// is gone. Silent connect builds the grid and lights the handle
// badge; opening the drawer loads thumbnails lazily; picking a tile
// loads that token, closes the drawer, and moves the highlight.
const { chromium } = require("playwright-core");
const { check } = require("./check.js");

const MOCK_PROVIDER = `
window.__ownedIds = [8014, 25495, 25470];
window.__renderCalls = 0;
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
				window.__renderCalls++;
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
	// The handle carries the always-visible presence dot
	check(
		await page.evaluate(() =>
			document.getElementById("profileHandle").classList.contains("statusDot"),
		),
		"profile handle missing the status dot",
	);
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
	// Thumbnails compose from the library: ZERO on-chain renders
	// (docs/tads/profile-drawer.md Decision 9)
	const renderCalls = await page.evaluate(() => window.__renderCalls);
	console.log("renderAvastar calls:", renderCalls);
	check(
		renderCalls === 0,
		"thumbnails hit the chain render RPC " + renderCalls + "x",
	);
	await page.screenshot({ path: "profile-open.png" });

	// Pick the second Avastar: loads it, closes the drawer, moves
	// the highlight
	await page.locator("#profileGrid .profileTile").nth(1).click();
	// The drawer stays OPEN across a pick (operator QA 2026-08-28)
	await page.waitForFunction(
		() =>
			document.getElementById("preloader")?.style.opacity === "0" &&
			document.querySelector(".profileTile.current")?.dataset.token !== "8014",
		{ timeout: 15000 },
	);
	check(
		await page.evaluate(() =>
			document.getElementById("sidePanel").classList.contains("open"),
		),
		"picking an owned Avastar closed the drawer",
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

	// Log out: the drawer returns to Link Wallet, the badge and
	// grid clear, and the choice persists
	await page.click("#profileHandle");
	await page.waitForSelector(".profileLogout", { timeout: 5000 });
	await page.click(".profileLogout");
	const loggedOut = await page.evaluate(() => ({
		button: document.querySelector(".connectButton")?.innerText || null,
		badge: document
			.getElementById("profileHandle")
			.classList.contains("connected"),
		tiles: document.querySelectorAll("#profileGrid .profileTile").length,
		stored: localStorage.getItem("kwigbelle.wallet"),
		flag: localStorage.getItem("kwigbelle.disconnected"),
	}));
	console.log("logged out:", JSON.stringify(loggedOut));
	check(
		loggedOut.button === "🔗 Link Wallet",
		"logout did not restore the connect button: " + loggedOut.button,
	);
	check(!loggedOut.badge, "handle badge still lit after logout");
	check(loggedOut.tiles === 0, "grid not cleared by logout");
	check(loggedOut.stored === null, "remembered wallet survived logout");
	check(loggedOut.flag === "1", "logout flag not persisted");

	// A reload stays logged out: no silent reconnect
	await page.reload();
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.waitForTimeout(800);
	const afterReload = await page.evaluate(() => ({
		tiles: document.querySelectorAll("#profileGrid .profileTile").length,
		badge: document
			.getElementById("profileHandle")
			.classList.contains("connected"),
	}));
	console.log("after logged-out reload:", JSON.stringify(afterReload));
	check(afterReload.tiles === 0, "silent reconnect after logout");
	check(!afterReload.badge, "badge lit after logged-out reload");

	// Link Wallet ends the logged-out state and reconnects (the
	// reconnect loads the first owned token, so the highlight lands
	// on it via finishLoad)
	await page.click("#profileHandle");
	await page.waitForSelector(".connectButton", { timeout: 5000 });
	await page.click(".connectButton");
	await page.waitForFunction(
		() =>
			document.querySelectorAll("#profileGrid .profileTile").length === 3 &&
			document
				.getElementById("profileHandle")
				.classList.contains("connected") &&
			document.querySelector(".profileTile.current")?.dataset.token ===
				"8014" &&
			document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 20000 },
	);
	console.log("reconnected after logout");

	// Logout/reconnect while the DISPLAYED token is already the
	// first owned one: the reconnect's same-token load
	// short-circuits (no finishLoad), so the highlight must survive
	// from the preserved currentTokenId
	await page.click(".profileLogout");
	await page.waitForSelector(".connectButton", { timeout: 5000 });
	await page.click(".connectButton");
	await page.waitForFunction(
		() =>
			document.querySelectorAll("#profileGrid .profileTile").length === 3 &&
			document.querySelector(".profileTile.current")?.dataset.token === "8014",
		{ timeout: 20000 },
	);
	console.log("same-token reconnect keeps the highlight");

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
