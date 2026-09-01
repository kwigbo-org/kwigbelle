const { chromium } = require("playwright-core");
const { check } = require("./check.js");

function mockProvider({ chainId, renderFails }) {
	// chainId is interpolated into executed page JS below — reject
	// anything that isn't a plain hex chain id before it gets there.
	if (!/^0x[0-9a-fA-F]+$/.test(chainId)) {
		throw new Error("invalid mock chainId: " + chainId);
	}
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
	// The backup indicator probes the absolute mirror URL; answer
	// locally so no test touches the real network
	await page.route("https://kwigbelle.com/vrm/Avastar_*.vrm", (route) =>
		route.fulfill({ status: 200, body: "" }),
	);
	await page.goto("http://localhost:8741/index.html");
	let loaded = true;
	try {
		await page.waitForFunction(
			() => document.getElementById("preloader")?.style.opacity === "0",
			{ timeout: 15000 },
		);
	} catch {
		loaded = false;
	}
	// Let the layer blob images finish loading and drawing
	await page.waitForTimeout(1500);
	const state = await page.evaluate(() => ({
		gridTiles: document.querySelectorAll("#profileGrid .profileCard").length,
		canvasDrawn: (() => {
			const c = document.getElementById("mainCanvas");
			const px = c
				.getContext("2d")
				.getImageData(c.width / 2, c.height / 2, 1, 1).data;
			return px[3] !== 0;
		})(),
	}));
	console.log(
		`${name}: loaded=${loaded} avatarDrawn=${state.canvasDrawn} gridTiles=${state.gridTiles} alerts=${JSON.stringify(alerts)} pageErrors=${JSON.stringify(pageErrors)}`,
	);
	// Trait composition renders without the chain, so every scenario —
	// including wrong chain and failing render RPC — must still load
	// and draw, with no alerts or page errors.
	check(loaded, `${name}: preloader never cleared`);
	check(state.canvasDrawn, `${name}: avatar not drawn`);
	check(alerts.length === 0, `${name}: alerts: ` + JSON.stringify(alerts));
	check(
		pageErrors.length === 0,
		`${name}: page errors: ` + JSON.stringify(pageErrors),
	);
	await browser.close();
}

(async () => {
	await run("happy-mainnet     ", { chainId: "0x1", renderFails: false });
	await run("wrong-chain (0x89)", { chainId: "0x89", renderFails: false });
	await run("render-rpc-fails  ", { chainId: "0x1", renderFails: true });
})();
