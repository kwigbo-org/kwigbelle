const { chromium } = require("playwright-core");

function mockProvider({ chainId, renderFails }) {
	return `
window.__ownedIds = [8014, 25495, 25470];
window.ethereum = {
	isMetaMask: true,
	on: () => {},
	removeListener: () => {},
	request: async ({ method, params }) => {
		if (method === "eth_accounts" || method === "eth_requestAccounts") {
			return ["0x1111111111111111111111111111111111111111"];
		}
		if (method === "eth_chainId") return "${chainId}";
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
				${renderFails ? 'throw new Error("execution aborted (gas limit)");' : ""}
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
	let loaded = true;
	try {
		await page.waitForFunction(
			() => document.getElementById("preloader")?.style.opacity === "0",
			{ timeout: 15000 }
		);
	} catch {
		loaded = false;
	}
	// Let the layer blob images finish loading and drawing
	await page.waitForTimeout(1500);
	const state = await page.evaluate(() => ({
		picker: !!document.getElementById("avastarPicker"),
		canvasDrawn: (() => {
			const c = document.getElementById("mainCanvas");
			const px = c
				.getContext("2d")
				.getImageData(c.width / 2, c.height / 2, 1, 1).data;
			return px[3] !== 0;
		})(),
	}));
	console.log(
		`${name}: loaded=${loaded} avatarDrawn=${state.canvasDrawn} picker=${state.picker} alerts=${JSON.stringify(alerts)} pageErrors=${JSON.stringify(pageErrors)}`
	);
	await browser.close();
}

(async () => {
	await run("happy-mainnet     ", { chainId: "0x1", renderFails: false });
	await run("wrong-chain (0x89)", { chainId: "0x89", renderFails: false });
	await run("render-rpc-fails  ", { chainId: "0x1", renderFails: true });
})();
