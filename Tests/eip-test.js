const { chromium } = require("playwright-core");

// EIP-6963 wallet mock. No window.ethereum unless `legacy`.
// `gestureRequired` makes eth_requestAccounts fail the first time
// (page-load prompt blocked) and succeed after (tap-initiated).
function mockProvider({ legacy, gestureRequired }) {
	return `
window.__ownedIds = [8014, 25495, 25470];
window.__requestAccountCalls = 0;
const provider = {
	on: () => {},
	removeListener: () => {},
	request: async ({ method, params }) => {
		if (method === "eth_accounts") {
			// Unauthorized wallets report no accounts until the site
			// has been approved via eth_requestAccounts
			${gestureRequired ? "return window.__requestAccountCalls > 0 ? ['0x1111111111111111111111111111111111111111'] : [];" : "return ['0x1111111111111111111111111111111111111111'];"}
		}
		if (method === "eth_requestAccounts") {
			window.__requestAccountCalls++;
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
${legacy ? "window.ethereum = provider;" : ""}
// Announce per EIP-6963, and re-announce when asked
const announce = () => window.dispatchEvent(
	new CustomEvent("eip6963:announceProvider", {
		detail: { info: { name: "MockWallet", uuid: "mock-1" }, provider },
	})
);
window.addEventListener("eip6963:requestProvider", announce);
announce();
`;
}

async function run(name, opts) {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const alerts = [];
	const pageErrors = [];
	page.on("dialog", (d) => {
		alerts.push(d.message());
		d.dismiss();
	});
	page.on("pageerror", (e) => pageErrors.push(e.message));
	await page.addInitScript(mockProvider(opts));
	await page.goto("http://localhost:8741/index.html");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 }
	);

	if (opts.gestureRequired) {
		// Expect the Link Wallet button, tap it, then expect the picker
		await page.waitForSelector(".connectButton", { timeout: 10000 });
		await page.screenshot({ path: "link-wallet-button.png" });
		const prompts = await page.evaluate(() => window.__requestAccountCalls);
		if (prompts !== 0) throw new Error("prompted on page load!");
		await page.click(".connectButton");
	}
	await page.waitForSelector(".pickerThumb.current img", { timeout: 15000 });
	const items = await page.evaluate(
		() => document.querySelectorAll("#pickerList .pickerThumb").length
	);
	console.log(
		`${name}: picker with ${items} items, alerts=${JSON.stringify(alerts)} pageErrors=${JSON.stringify(pageErrors)}`
	);
	await browser.close();
}

(async () => {
	await run("eip6963-only     ", { legacy: false, gestureRequired: false });
	await run("eip6963+legacy   ", { legacy: true, gestureRequired: false });
	await run("gesture-required ", { legacy: false, gestureRequired: true });
})();
