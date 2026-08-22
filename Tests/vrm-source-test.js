// VRMSource pipeline (docs/tads/vrm-viewer.md Step 2): metadata ->
// vrm_url -> gateway fallback with streamed progress and caching,
// verified against routed fixtures - no real network is touched.
const { chromium } = require("playwright-core");
const { check } = require("./check.js");

(async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

	// Deterministic fake model bytes (content checked after transit)
	const CID = "bafytestcidaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
	const bytes = Buffer.alloc(131072);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = i % 251;
	}
	const cors = { "access-control-allow-origin": "*" };
	let mode = "happy";
	const hits = { metadata: 0, pinata: 0, ipfsio: 0, dweb: 0 };

	await page.route("**://avastars.io/metadata/**", (route) => {
		hits.metadata++;
		route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: cors,
			body: JSON.stringify({
				name: "Avastar #8014",
				vrm_url: `https://ipfs.io/ipfs/${CID}/Avastar_Prime_8014.vrm`,
			}),
		});
	});
	await page.route("**/ipfs/**", (route) => {
		const host = new URL(route.request().url()).hostname;
		if (host.includes("pinata")) {
			hits.pinata++;
		} else if (host === "ipfs.io") {
			hits.ipfsio++;
		} else {
			hits.dweb++;
		}
		const failThis =
			mode === "allfail" || (mode === "fallback" && host.includes("pinata"));
		if (failThis) {
			route.fulfill({ status: 504, headers: cors, body: "gateway timeout" });
			return;
		}
		route.fulfill({
			status: 200,
			contentType: "application/octet-stream",
			headers: cors,
			body: bytes,
		});
	});

	await page.goto("http://localhost:8741/index.html?tokenid=8014");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);

	// Happy path: pinata serves; progress streams to completion
	const happy = await page.evaluate(async () => {
		const { default: VRMSource } = await import("../Lib/VRMSource.js");
		window.__source = new VRMSource();
		const info = await window.__source.vrmInfo(8014);
		const progress = [];
		const buffer = await window.__source.fetchVRM(8014, (loaded, total) =>
			progress.push([loaded, total]),
		);
		const view = new Uint8Array(buffer);
		return {
			filename: info.filename,
			byteLength: buffer.byteLength,
			progressCount: progress.length,
			lastProgress: progress[progress.length - 1],
			spotBytes: [view[0], view[100], view[131071]],
		};
	});
	console.log("happy:", JSON.stringify(happy));
	check(
		happy.filename === "Avastar_Prime_8014.vrm",
		"wrong filename: " + happy.filename,
	);
	check(happy.byteLength === 131072, "wrong byte length");
	check(
		happy.progressCount > 0 &&
			happy.lastProgress[0] === 131072 &&
			happy.lastProgress[1] === 131072,
		"progress did not stream to completion: " + JSON.stringify(happy),
	);
	check(
		happy.spotBytes[0] === 0 &&
			happy.spotBytes[1] === 100 &&
			happy.spotBytes[2] === 131071 % 251,
		"bytes corrupted in transit",
	);
	check(
		hits.pinata === 1 && hits.ipfsio === 0 && hits.metadata === 1,
		"unexpected gateway order: " + JSON.stringify(hits),
	);

	// Cache: a second fetch touches no route at all
	const cachedLength = await page.evaluate(async () => {
		const buffer = await window.__source.fetchVRM(8014);
		return buffer.byteLength;
	});
	check(cachedLength === 131072, "cached fetch returned wrong bytes");
	check(
		hits.pinata === 1 && hits.metadata === 1,
		"cache did not prevent refetch: " + JSON.stringify(hits),
	);

	// Fallback: pinata 504s, ipfs.io serves (fresh instance so
	// nothing is cached)
	mode = "fallback";
	const fallback = await page.evaluate(async () => {
		const { default: VRMSource } = await import("../Lib/VRMSource.js");
		const source = new VRMSource();
		const buffer = await source.fetchVRM(8014);
		return buffer.byteLength;
	});
	check(fallback === 131072, "fallback fetch returned wrong bytes");
	check(
		hits.pinata === 2 && hits.ipfsio === 1,
		"504 did not advance to the next gateway: " + JSON.stringify(hits),
	);

	// All gateways fail: the pipeline rejects with the last error
	mode = "allfail";
	const failure = await page.evaluate(async () => {
		const { default: VRMSource } = await import("../Lib/VRMSource.js");
		const source = new VRMSource();
		try {
			await source.fetchVRM(8014);
			return null;
		} catch (error) {
			return error.message;
		}
	});
	console.log("all-fail message:", failure);
	check(
		typeof failure === "string" && failure.includes("504"),
		"all-gateway failure did not reject with the HTTP error",
	);
	check(
		hits.pinata === 3 && hits.ipfsio === 2 && hits.dweb === 1,
		"all-fail did not try every gateway: " + JSON.stringify(hits),
	);

	// Abort: rejects with AbortError and does NOT advance gateways
	const abort = await page.evaluate(async () => {
		const { default: VRMSource } = await import("../Lib/VRMSource.js");
		const source = new VRMSource();
		const controller = new AbortController();
		controller.abort();
		try {
			await source.fetchVRM(8014, null, controller.signal);
			return null;
		} catch (error) {
			return error.name;
		}
	});
	check(abort === "AbortError", "abort did not rethrow: " + abort);
	// An aborted signal rejects before any request is issued, and
	// must not advance to another gateway either
	check(
		hits.pinata === 3 && hits.ipfsio === 2 && hits.dweb === 1,
		"abort advanced gateways anyway: " + JSON.stringify(hits),
	);

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
