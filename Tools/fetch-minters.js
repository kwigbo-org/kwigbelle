// docs/tads/info-tab.md (identity card revision, operator QA
// 2026-08-28): fetch every token's ORIGINAL MINTER into
// Tools/data/minters.json. Mints are frozen facts - the factory is
// closed and the contract locked - so one committed capture serves
// the walletless site forever, same doctrine as hashes/ub/burned.
//
// Method: alchemy_getAssetTransfers (the endpoint is the
// operator's Alchemy key - free tier caps raw eth_getLogs at a
// 10-BLOCK range, but its indexed transfer API pages all ~26.6k
// mints in ~27 calls): fromAddress 0x0 + the contract = every
// mint, with tokenId, minter, and block number. Output dedupes
// addresses - { addresses: [unique...], minterIndex: { tokenId:
// index }, mintBlock: { tokenId: block } } - mintBlock exists so
// --verify can re-check any token with a ONE-block eth_getLogs
// (free-tier legal) straight against the chain.
//
// Usage: AVASTARS_RPC_URL=<endpoint> node Tools/fetch-minters.js
//        ... --verify [N]   re-query N random tokens' mint logs
//                           at their recorded block and compare
const fs = require("fs");
const path = require("path");

const RPC = process.env.AVASTARS_RPC_URL;
if (!RPC) {
	console.error("AVASTARS_RPC_URL not set");
	process.exit(1);
}
const CONTRACT = "0xF3E778F839934fC819cFA1040AabaCeCBA01e049";
const TRANSFER_TOPIC =
	"0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_WORD =
	"0x0000000000000000000000000000000000000000000000000000000000000000";
// The contract went live in early 2020; scanning a little early
// costs a few empty ranges, nothing more
const START_BLOCK = 9400000;
const DATA_DIR = path.join(__dirname, "data");
const OUT_FILE = path.join(DATA_DIR, "minters.json");
const MAX_RETRIES = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (n) => "0x" + n.toString(16);
const wordToAddress = (word) => "0x" + word.slice(26);

async function rpc(method, params) {
	for (let attempt = 0; ; attempt++) {
		try {
			const res = await fetch(RPC, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
			});
			const json = await res.json();
			if (json.error) {
				throw new Error(json.error.message || "rpc error");
			}
			return json.result;
		} catch (error) {
			// Range/result-cap errors are the CALLER's signal to halve
			// the range - never retried here
			if (
				/response size|results|range|10000|block range/i.test(error.message)
			) {
				throw error;
			}
			if (attempt >= MAX_RETRIES) {
				throw error;
			}
			await sleep(1200 * Math.pow(1.6, attempt));
		}
	}
}

async function mintLogs(fromBlock, toBlock, tokenTopic) {
	return rpc("eth_getLogs", [
		{
			address: CONTRACT,
			fromBlock: hex(fromBlock),
			toBlock: hex(toBlock),
			topics: [TRANSFER_TOPIC, ZERO_WORD, null, tokenTopic || null],
		},
	]);
}

async function capture() {
	const minters = new Map(); // tokenId -> { address, block }
	let pageKey;
	let pages = 0;
	do {
		const params = {
			fromBlock: hex(START_BLOCK),
			toBlock: "latest",
			fromAddress: "0x0000000000000000000000000000000000000000",
			contractAddresses: [CONTRACT],
			category: ["erc721"],
			maxCount: "0x3e8",
			order: "asc",
		};
		if (pageKey) {
			params.pageKey = pageKey;
		}
		const result = await rpc("alchemy_getAssetTransfers", [params]);
		for (const transfer of result.transfers) {
			const tokenId = Number(BigInt(transfer.tokenId));
			minters.set(tokenId, {
				address: transfer.to.toLowerCase(),
				block: Number(BigInt(transfer.blockNum)),
			});
		}
		pageKey = result.pageKey;
		pages++;
		process.stdout.write(
			`\r  page ${pages} · ${minters.size.toLocaleString()} mints`,
		);
		await sleep(400);
	} while (pageKey);
	console.log();
	// Dedupe: collectors minted in bulk, so unique addresses are a
	// small fraction of tokens
	const addresses = [...new Set([...minters.values()].map((m) => m.address))];
	const indexOf = new Map(addresses.map((a, i) => [a, i]));
	const minterIndex = {};
	const mintBlock = {};
	for (const [tokenId, mint] of [...minters].sort((a, b) => a[0] - b[0])) {
		minterIndex[tokenId] = indexOf.get(mint.address);
		mintBlock[tokenId] = mint.block;
	}
	fs.mkdirSync(DATA_DIR, { recursive: true });
	fs.writeFileSync(
		OUT_FILE,
		JSON.stringify({ addresses, minterIndex, mintBlock }),
	);
	console.log(
		`${minters.size.toLocaleString()} mints by ` +
			`${addresses.length.toLocaleString()} unique minters -> ${OUT_FILE}`,
	);
}

async function verify(sampleSize) {
	const { addresses, minterIndex, mintBlock } = JSON.parse(
		fs.readFileSync(OUT_FILE, "utf8"),
	);
	const tokenIds = Object.keys(minterIndex);
	let bad = 0;
	for (let i = 0; i < sampleSize; i++) {
		const tokenId = tokenIds[Math.floor(Math.random() * tokenIds.length)];
		const topic = "0x" + BigInt(tokenId).toString(16).padStart(64, "0");
		// A one-block range at the recorded mint block: free-tier
		// legal, and byte-for-byte against the raw chain log
		const block = mintBlock[tokenId];
		const logs = await mintLogs(block, block, topic);
		const onChain = logs.length > 0 ? wordToAddress(logs[0].topics[2]) : null;
		const recorded = addresses[minterIndex[tokenId]];
		const ok = onChain === recorded;
		console.log(
			`#${tokenId} @${block}: ${recorded} ${ok ? "OK" : `MISMATCH (${onChain})`}`,
		);
		if (!ok) {
			bad++;
		}
		await sleep(300);
	}
	console.log(`${sampleSize - bad}/${sampleSize} verified`);
	process.exit(bad === 0 ? 0 : 1);
}

(async () => {
	const argv = process.argv.slice(2);
	if (argv.includes("--verify")) {
		const at = argv.indexOf("--verify");
		await verify(Number(argv[at + 1]) || 20);
	} else {
		await capture();
	}
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
