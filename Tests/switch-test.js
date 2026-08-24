const { chromium } = require("playwright-core");
const { check } = require("./check.js");

// Wallet authorized for the site but pinned to Base (0x2105).
// wallet_switchEthereumChain updates the chain (persisted in
// sessionStorage so it survives the page reload) and fires
// chainChanged like a real wallet.
const MOCK = `
window.__ownedIds = [8014, 25495, 25470];
const listeners = {};
const chain = () => sessionStorage.getItem("mockChain") || "0x2105";
window.ethereum = {
	on: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
	removeListener: () => {},
	request: async ({ method, params }) => {
		if (method === "eth_accounts" || method === "eth_requestAccounts") {
			return ["0x1111111111111111111111111111111111111111"];
		}
		if (method === "eth_chainId") return chain();
		if (method === "wallet_switchEthereumChain") {
			sessionStorage.setItem("mockChain", params[0].chainId);
			(listeners["chainChanged"] || []).forEach((fn) => fn(params[0].chainId));
			return null;
		}
		if (method === "net_version") return String(parseInt(chain(), 16));
		if (method === "eth_blockNumber") return "0x1";
		if (method === "eth_call") {
			if (chain() !== "0x1") throw new Error("contract not on this chain");
			const w3 = new Web3();
			const abi = w3.eth.abi;
			const data = params[0].data;
			const sel = data.slice(0, 10);
			const sig = (s) => abi.encodeFunctionSignature(s);
			if (sel === sig("balanceOf(address)")) {
				return abi.encodeParameter("uint256", window.__ownedIds.length);
			}
			if (sel === sig("tokenOfOwnerByIndex(address,uint256)")) {
				return abi.encodeParameter("uint256", window.__ownedIds[parseInt(data.slice(-64), 16)]);
			}
			if (sel === sig("renderAvastar(uint256)")) {
				const id = parseInt(data.slice(-64), 16);
				const res = await fetch("/SVG/Avastar-" + id + ".svg");
				return abi.encodeParameter("string", await res.text());
			}
			throw new Error("unmocked eth_call " + sel);
		}
		throw new Error("unmocked method " + method);
	},
};
`;

(async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const alerts = [];
	const pageErrors = [];
	page.on("dialog", (d) => {
		alerts.push(d.message());
		d.dismiss();
	});
	page.on("pageerror", (e) => pageErrors.push(e.message));
	await page.addInitScript(MOCK);

	await page.goto("http://localhost:8741/index.html");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	// The network-fix button lives in the profile drawer now: open
	// it and expect the button, labeled accordingly
	await page.click("#profileHandle");
	await page.waitForSelector(".connectButton", { timeout: 10000 });
	const label = await page.locator(".connectButton").innerText();
	console.log("button label:", JSON.stringify(label));
	check(
		label.includes("Switch to Mainnet"),
		"wrong-network button label: " + JSON.stringify(label),
	);
	await page.screenshot({ path: "switch-button.png" });

	// Tap: wallet "switches" to mainnet, page reloads, the grid
	// builds silently (the reload closes the drawer, so tiles exist
	// without thumbnails)
	await page.click(".connectButton");
	await page.waitForFunction(
		() => document.querySelectorAll("#profileGrid .profileTile").length === 3,
		{ timeout: 20000 },
	);
	const items = await page.evaluate(
		() => document.querySelectorAll("#profileGrid .profileTile").length,
	);
	console.log(
		`after switch: grid with ${items} tiles, alerts=${JSON.stringify(alerts)} pageErrors=${JSON.stringify(pageErrors)}`,
	);
	check(items === 3, "expected 3 grid tiles after switch, got " + items);
	check(alerts.length === 0, "alerts: " + JSON.stringify(alerts));
	check(pageErrors.length === 0, "page errors: " + JSON.stringify(pageErrors));
	await page.screenshot({ path: "switch-after.png" });
	await browser.close();
})();
