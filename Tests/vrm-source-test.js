// VRMSource pipeline (docs/tads/vrm-viewer.md Step 2): metadata ->
// vrm_url -> gateway fallback with streamed progress and caching,
// verified against routed fixtures - no real network is touched.
const http = require("http");
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
	await page.route("**/ipfs/**", async (route) => {
		const host = new URL(route.request().url()).hostname;
		if (host.includes("pinata")) {
			hits.pinata++;
		} else if (host === "ipfs.io") {
			hits.ipfsio++;
		} else {
			hits.dweb++;
		}
		if (mode === "hang" && host.includes("pinata")) {
			// A gateway that accepts the request and then goes
			// silent - the field failure the hedge exists for. By
			// the time this fulfills, the attempt is aborted.
			await new Promise((resolve) => setTimeout(resolve, 3000));
			try {
				await route.fulfill({ status: 504, headers: cors, body: "late" });
			} catch {
				// aborted request - expected
			}
			return;
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
	// An aborted signal rejects before any request is issued - the
	// signal covers the metadata phase too, so NO endpoint (metadata
	// or gateway) may see a request
	check(
		hits.metadata === 3 &&
			hits.pinata === 3 &&
			hits.ipfsio === 2 &&
			hits.dweb === 1,
		"abort still issued a request: " + JSON.stringify(hits),
	);

	// Hung gateway: pinata accepts and stalls; the stagger starts
	// ipfs.io in parallel and it wins the race well before the
	// hung attempt's own timeout
	mode = "hang";
	const hung = await page.evaluate(async () => {
		const { default: VRMSource } = await import("../Lib/VRMSource.js");
		const source = new VRMSource();
		source.staggerMs = 400;
		const start = performance.now();
		const buffer = await source.fetchVRM(8014);
		return {
			byteLength: buffer.byteLength,
			elapsed: performance.now() - start,
		};
	});
	console.log("hung-gateway rescue:", JSON.stringify(hung));
	check(hung.byteLength === 131072, "hedged fetch returned wrong bytes");
	// Hit counts are the primary signal; the elapsed bound just
	// proves we didn't sit out the full 3s hang sequentially
	check(
		hung.elapsed < 2800,
		"hedge did not rescue a hung gateway in time: " + hung.elapsed,
	);
	check(
		hits.pinata === 4 && hits.ipfsio === 3,
		"hedge should have raced pinata (hung) and ipfs.io: " +
			JSON.stringify(hits),
	);

	// Mid-stream death and empty bodies need a REAL streaming
	// server (route.fulfill is atomic): /partial/ sends headers +
	// half the bytes then kills the socket, /empty/ 200s with no
	// body, /good/ serves fully. The page's VRMSource gets these
	// as its gateway list directly.
	const serverHits = { partial: 0, empty: 0, good: 0 };
	const fixtureServer = http.createServer((request, response) => {
		const head = {
			"Access-Control-Allow-Origin": "*",
			"Content-Type": "application/octet-stream",
		};
		if (request.url.startsWith("/partial/")) {
			serverHits.partial++;
			response.writeHead(200, {
				...head,
				"Content-Length": String(bytes.length),
			});
			response.write(bytes.subarray(0, 65536));
			setTimeout(() => response.destroy(), 100);
			return;
		}
		if (request.url.startsWith("/empty/")) {
			serverHits.empty++;
			response.writeHead(200, head);
			response.end();
			return;
		}
		if (request.url.startsWith("/good/")) {
			serverHits.good++;
			response.writeHead(200, {
				...head,
				"Content-Length": String(bytes.length),
			});
			response.end(bytes);
			return;
		}
		response.writeHead(404, head);
		response.end();
	});
	await new Promise((resolve) => fixtureServer.listen(8799, resolve));

	// A winner that dies mid-download gives up the crown and the
	// race resumes with the not-yet-started candidate
	const midStream = await page.evaluate(async () => {
		const { default: VRMSource } = await import("../Lib/VRMSource.js");
		const source = new VRMSource();
		source.gateways = [
			"http://localhost:8799/partial/",
			"http://localhost:8799/good/",
		];
		source.staggerMs = 200;
		const buffer = await source.fetchVRM(8014);
		const view = new Uint8Array(buffer);
		return { byteLength: buffer.byteLength, spot: view[131071] };
	});
	console.log("mid-stream death rescue:", JSON.stringify(midStream));
	check(
		midStream.byteLength === 131072 && midStream.spot === 131071 % 251,
		"mid-stream winner death was not rescued: " + JSON.stringify(midStream),
	);
	check(
		serverHits.partial === 1 && serverHits.good === 1,
		"unexpected lane usage: " + JSON.stringify(serverHits),
	);

	// An empty 200 body counts as a failure and advances the race
	// instead of wedging the bookkeeping
	const emptyBody = await page.evaluate(async () => {
		const { default: VRMSource } = await import("../Lib/VRMSource.js");
		const source = new VRMSource();
		source.gateways = [
			"http://localhost:8799/empty/",
			"http://localhost:8799/good/",
		];
		source.staggerMs = 5000; // fail-fast must advance, not the stagger
		const start = performance.now();
		const buffer = await source.fetchVRM(8014);
		return {
			byteLength: buffer.byteLength,
			elapsed: performance.now() - start,
		};
	});
	console.log("empty-body advance:", JSON.stringify(emptyBody));
	check(
		emptyBody.byteLength === 131072,
		"empty body did not advance to the good lane",
	);
	check(
		emptyBody.elapsed < 4000,
		"empty body waited out the stagger instead of failing fast: " +
			emptyBody.elapsed,
	);
	check(
		serverHits.empty === 1 && serverHits.good === 2,
		"unexpected empty-body lane usage: " + JSON.stringify(serverHits),
	);
	fixtureServer.close();

	// Qm CIDs rewrite to CIDv1 in candidate URLs (pair verified
	// live against pinata: both forms serve byte-identically)
	const cidRewrite = await page.evaluate(async () => {
		const { default: VRMSource } = await import("../Lib/VRMSource.js");
		const source = new VRMSource();
		return {
			qm: source.candidateURLs(
				"https://ipfs.io/ipfs/QmaqBQnFksmUBXzVqsoMi8hu6wVgj99HAmDnm3FVtjBLQ3/Avastar_Replicant_25500.vrm",
			),
			bafy: source.candidateURLs(
				"https://ipfs.io/ipfs/bafytestcid/Avastar_Prime_8014.vrm",
			),
		};
	});
	check(
		cidRewrite.qm.every((u) =>
			u.includes(
				"/ipfs/bafybeifztm4emp3u4xkaekpvyqbdxg5uhaxr2zxilqwargr5q7g52snh6q/Avastar_Replicant_25500.vrm",
			),
		),
		"Qm CID not rewritten to the verified CIDv1: " +
			JSON.stringify(cidRewrite.qm),
	);
	check(
		cidRewrite.bafy.every((u) => u.includes("/ipfs/bafytestcid/")),
		"CIDv1 URLs must pass through untouched",
	);

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
