// TAD Step 2 (docs/tads/trait-composition.md): fetch every token's
// trait hash + metadata into Tools/data/hashes.json.
//
// Routing: most tokens are primes, so getPrimeByTokenId is tried
// first and revert-failures are retried as replicants - cheaper
// than a getAvastarWaveByTokenId pre-call per token.
//
// Throttling: Alchemy free tier caps compute units per SECOND and
// reports overage as per-item JSON-RPC errors inside an HTTP 200
// batch response. Capacity errors are retried with backoff; batch
// size and delay are tuned to sit under the cap.
//
// Usage: AVASTARS_RPC_URL=<endpoint> node Tools/fetch-hashes.js
// Resumable: already-fetched tokens in hashes.json are skipped.
const fs = require("fs");
const path = require("path");

const RPC = process.env.AVASTARS_RPC_URL;
if (!RPC) {
	console.error("AVASTARS_RPC_URL not set");
	process.exit(1);
}
const CONTRACT = "0xF3E778F839934fC819cFA1040AabaCeCBA01e049";
// Selectors precomputed from the ABI signatures (web3
// encodeFunctionSignature); keeps this tool dependency-free.
const SEL = {
	totalSupply: "0x18160ddd",
	getPrimeByTokenId: "0x0dd4cf9a",
	getReplicantByTokenId: "0xc98c3434",
};
const DATA_DIR = path.join(__dirname, "data");
const OUT_FILE = path.join(DATA_DIR, "hashes.json");
const BATCH_SIZE = 40;
const BATCH_DELAY_MS = 3400; // ~40*26 CU / 3.4s ≈ 306 CU/s, under the free cap
const MAX_RETRIES = 8;

const pad = (n) => BigInt(n).toString(16).padStart(64, "0");
const word = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const num = (hex, i) => BigInt("0x" + word(hex, i));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isCapacityError = (e) =>
	/capacity|exceeded|throughput|rate/i.test(e.message || "");

// One batched request; capacity-limited items are retried in place.
// Returns { id: resultHex | Error } where surviving Errors are
// non-retryable (e.g. execution reverts).
async function rpcBatch(calls) {
	const out = {};
	let remaining = calls;
	for (let attempt = 0; remaining.length > 0 && attempt <= MAX_RETRIES; attempt++) {
		if (attempt > 0) await sleep(1500 * Math.pow(1.6, attempt));
		const body = remaining.map((c) => ({
			jsonrpc: "2.0",
			id: c.id,
			method: "eth_call",
			params: [{ to: CONTRACT, data: c.data }, "latest"],
		}));
		let json;
		try {
			const res = await fetch(RPC, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			json = await res.json();
		} catch (error) {
			continue; // transport error: retry whole remainder
		}
		const entries = Array.isArray(json) ? json : [json];
		const retry = [];
		const byId = new Map(remaining.map((c) => [c.id, c]));
		for (const entry of entries) {
			const call = byId.get(entry.id);
			if (!call) continue;
			if (entry.error) {
				const err = new Error(entry.error.message);
				if (isCapacityError(err)) {
					retry.push(call);
				} else {
					out[entry.id] = err;
				}
			} else {
				out[entry.id] = entry.result;
			}
			byId.delete(entry.id);
		}
		retry.push(...byId.values()); // items missing from the response
		remaining = retry;
	}
	for (const c of remaining) {
		out[c.id] = new Error("exhausted retries (capacity)");
	}
	return out;
}

function decodeEntry(hex, isPrime) {
	// Prime:     tokenId, serial, traits, generation, series, gender, ranking
	// Replicant: tokenId, serial, traits, generation, gender, ranking
	const entry = {
		traits: "0x" + num(hex, 2).toString(16).padStart(64, "0"),
		generation: Number(num(hex, 3)),
		gender: Number(num(hex, isPrime ? 5 : 4)),
		ranking: Number(num(hex, isPrime ? 6 : 5)),
		kind: isPrime ? "prime" : "replicant",
	};
	if (isPrime) entry.series = Number(num(hex, 4));
	return entry;
}

async function main() {
	fs.mkdirSync(DATA_DIR, { recursive: true });
	const hashes = fs.existsSync(OUT_FILE)
		? JSON.parse(fs.readFileSync(OUT_FILE, "utf8"))
		: {};

	const supplyHex = (await rpcBatch([{ id: 0, data: SEL.totalSupply }]))[0];
	if (supplyHex instanceof Error) throw supplyHex;
	const supply = Number(num(supplyHex, 0));
	console.log(`totalSupply: ${supply}; already fetched: ${Object.keys(hashes).length}`);

	const pending = [];
	for (let tokenId = 0; tokenId < supply; tokenId++) {
		if (!hashes[tokenId]) pending.push(tokenId);
	}

	let hardFailures = 0;
	for (let i = 0; i < pending.length; i += BATCH_SIZE) {
		const chunk = pending.slice(i, i + BATCH_SIZE);
		// Pass 1: assume prime
		const primes = await rpcBatch(
			chunk.map((t) => ({ id: t, data: SEL.getPrimeByTokenId + pad(t) }))
		);
		const replicantIds = [];
		for (const t of chunk) {
			const hex = primes[t];
			if (hex instanceof Error) {
				replicantIds.push(t); // presumably a revert: not a prime
			} else {
				hashes[t] = decodeEntry(hex, true);
			}
		}
		// Pass 2: retry non-primes as replicants
		if (replicantIds.length > 0) {
			const reps = await rpcBatch(
				replicantIds.map((t) => ({ id: t, data: SEL.getReplicantByTokenId + pad(t) }))
			);
			for (const t of replicantIds) {
				const hex = reps[t];
				if (hex instanceof Error) {
					hardFailures++;
					console.warn(`token ${t}: failed both getters (${hex.message})`);
				} else {
					hashes[t] = decodeEntry(hex, false);
				}
			}
		}
		const doneCount = Math.min(i + BATCH_SIZE, pending.length);
		if (doneCount % (BATCH_SIZE * 10) < BATCH_SIZE || doneCount >= pending.length) {
			fs.writeFileSync(OUT_FILE, JSON.stringify(hashes));
			console.log(`progress: ${doneCount}/${pending.length} (saved)`);
		}
		await sleep(BATCH_DELAY_MS);
	}
	fs.writeFileSync(OUT_FILE, JSON.stringify(hashes));
	const kinds = Object.values(hashes).reduce((a, h) => {
		a[h.kind] = (a[h.kind] || 0) + 1;
		return a;
	}, {});
	console.log(`done: ${Object.keys(hashes).length} tokens ${JSON.stringify(kinds)}; hard failures: ${hardFailures}`);
	if (Object.keys(hashes).length < supply) process.exitCode = 1;
}

main().catch((e) => {
	console.error("FAILED:", e.message);
	process.exit(1);
});
