const { chromium } = require("playwright-core");

// Two EIP-6963 wallets. "RabbyMock" announces first and is on Base.
// "HotMock" is on mainnet, owns the Avastars, and authorizes on
// eth_requestAccounts (persisted so it survives the reload check).
const MOCK = `
window.__ownedIds = [8014, 25495, 25470];
window.__rabbyPrompts = 0;
const makeWallet = (name, uuid, chainId, canOwn) => ({
	info: { name, uuid, rdns: "io.mock." + name.toLowerCase(), icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" },
	provider: {
		on: () => {},
		removeListener: () => {},
		request: async ({ method, params }) => {
			if (method === "eth_accounts") {
				if (!canOwn) return [];
				return sessionStorage.getItem("hotAuthorized") ? ["0x1111111111111111111111111111111111111111"] : [];
			}
			if (method === "eth_requestAccounts") {
				if (!canOwn) { window.__rabbyPrompts++; return []; }
				sessionStorage.setItem("hotAuthorized", "1");
				return ["0x1111111111111111111111111111111111111111"];
			}
			if (method === "eth_chainId") return chainId;
			if (method === "net_version") return String(parseInt(chainId, 16));
			if (method === "eth_blockNumber") return "0x1";
			if (method === "eth_call") {
				if (!canOwn || chainId !== "0x1") throw new Error("wrong wallet/chain");
				const w3 = new Web3();
				const abi = w3.eth.abi;
				const data = params[0].data;
				const sel = data.slice(0, 10);
				const sig = (s) => abi.encodeFunctionSignature(s);
				if (sel === sig("balanceOf(address)")) return abi.encodeParameter("uint256", window.__ownedIds.length);
				if (sel === sig("tokenOfOwnerByIndex(address,uint256)")) return abi.encodeParameter("uint256", window.__ownedIds[parseInt(data.slice(-64), 16)]);
				if (sel === sig("renderAvastar(uint256)")) {
					const id = parseInt(data.slice(-64), 16);
					const res = await fetch("/SVG/Avastar-" + id + ".svg");
					return abi.encodeParameter("string", await res.text());
				}
				throw new Error("unmocked eth_call " + sel);
			}
			throw new Error("unmocked method " + method);
		},
	},
});
const rabby = makeWallet("RabbyMock", "uuid-rabby", "0x2105", false);
const hot = makeWallet("HotMock", "uuid-hot", "0x1", true);
const announce = () => {
	for (const w of [rabby, hot]) {
		window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: w }));
	}
};
window.addEventListener("eip6963:requestProvider", announce);
announce();
`;

(async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
	const page = await context.newPage();
	const alerts = [];
	const pageErrors = [];
	page.on("dialog", (d) => {
		alerts.push(d.message());
		d.dismiss();
	});
	page.on("pageerror", (e) => pageErrors.push(e.message));
	await context.addInitScript(MOCK);

	await page.goto("http://localhost:8741/index.html");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 }
	);
	await page.waitForSelector(".connectButton", { timeout: 10000 });

	// Tap the button: expect a chooser listing both wallets
	await page.click(".connectButton");
	await page.waitForSelector("#walletList", { timeout: 5000 });
	const names = await page.evaluate(() =>
		[...document.querySelectorAll(".walletRow span")].map((s) => s.innerText)
	);
	console.log("chooser lists:", JSON.stringify(names));
	await page.screenshot({ path: "wallet-chooser.png" });

	// Pick HotMock: expect connect + picker, and Rabby never prompted
	await page.click(".walletRow:nth-child(2)");
	await page.waitForSelector(".pickerThumb.current img", { timeout: 20000 });
	const rabbyPrompts = await page.evaluate(() => window.__rabbyPrompts);
	const stored = await page.evaluate(() =>
		localStorage.getItem("kwigbelle.wallet")
	);
	console.log(
		`picked HotMock: picker up, rabbyPrompts=${rabbyPrompts}, stored=${JSON.stringify(stored)}`
	);

	// Reload: the stored choice + authorized account should go
	// straight to the picker with no button and no chooser
	await page.reload();
	await page.waitForSelector(".pickerThumb.current img", { timeout: 20000 });
	const buttonAfter = await page.evaluate(
		() => !!document.querySelector(".connectButton")
	);
	console.log(
		`after reload: picker restored, connectButton=${buttonAfter}, alerts=${JSON.stringify(alerts)} pageErrors=${JSON.stringify(pageErrors)}`
	);
	await browser.close();
})();
