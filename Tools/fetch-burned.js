// TAD Step 2 (docs/tads/burned-traits.md): capture every prime's
// burned-trait flags into Tools/data/burned.json.
//
// getPrimeReplicationByTokenId(uint256) returns the token id plus
// an INLINE bool[12] whose index is the gene id (live-verified
// against the metadata endpoint's "- burned" markers, see the TAD).
// The contract is locked, so the flags are frozen forever - this is
// a one-time capture, like fetch-hashes.js.
//
// Output is SPARSE: only primes with at least one burn appear, as
// tokenId -> mask (12-bit integer, bit g = gene g burned). A
// resumable working file (burned-progress.json, disposable) tracks
// the sweep; the final sparse table is written only on completion.
//
// Usage: AVASTARS_RPC_URL=<endpoint> node Tools/fetch-burned.js
//        ... --verify [N]   sample N tokens (default 20) and check
//                           the committed table against the chain
//                           AND the metadata endpoint's
//                           "total traits burned" attribute
const fs = require("fs");
const path = require("path");

const RPC = process.env.AVASTARS_RPC_URL;
if (!RPC) {
	console.error("AVASTARS_RPC_URL not set");
	process.exit(1);
}
const CONTRACT = "0xF3E778F839934fC819cFA1040AabaCeCBA01e049";
// Selector precomputed with the site's bundled web3
// (encodeFunctionSignature), sanity-checked against fetch-hashes'
// known getPrimeByTokenId selector.
const SEL_REPLICATION = "0x480dacfa";
// The last prime ever minted is #25199 (operator-confirmed; the
// replicant factory is closed). Promos 0-199 are primes too.
const PRIME_COUNT = 25200;
const DATA_DIR = path.join(__dirname, "data");
const OUT_FILE = path.join(DATA_DIR, "burned.json");
const PROGRESS_FILE = path.join(DATA_DIR, "burned-progress.json");
const BATCH_SIZE = 40;
const BATCH_DELAY_MS = 3400; // same free-tier tuning as fetch-hashes.js
const MAX_RETRIES = 8;

const pad = (n) => BigInt(n).toString(16).padStart(64, "0");
const word = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const num = (hex, i) => BigInt("0x" + word(hex, i));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isCapacityError = (e) =>
	/capacity|exceeded|throughput|rate/i.test(e.message || "");

// One batched request; capacity-limited items are retried in place
// (same shape as fetch-hashes.js rpcBatch).
async function rpcBatch(calls) {
	const out = {};
	let remaining = calls;
	for (
		let attempt = 0;
		remaining.length > 0 && attempt <= MAX_RETRIES;
		attempt++
	) {
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

/// Decode a replication response: word 0 is the token id, words
/// 1-12 the inline bool[12] (index = gene). Returns the 12-bit mask.
function decodeMask(hex, expectedId) {
	if (typeof hex !== "string" || hex.length < 2 + 13 * 64) {
		throw new Error(`short response (${hex && hex.length} chars)`);
	}
	const id = Number(num(hex, 0));
	if (id !== expectedId) {
		throw new Error(`response id ${id} != requested ${expectedId}`);
	}
	let mask = 0;
	for (let gene = 0; gene < 12; gene++) {
		const flag = Number(num(hex, 1 + gene));
		if (flag !== 0 && flag !== 1) {
			throw new Error(`token ${id} gene ${gene}: non-bool flag ${flag}`);
		}
		if (flag === 1) mask |= 1 << gene;
	}
	return mask;
}

const popcount = (mask) => {
	let n = 0;
	for (let g = 0; g < 12; g++) if (mask & (1 << g)) n++;
	return n;
};

async function chainMask(tokenId) {
	const res = await rpcBatch([
		{ id: tokenId, data: SEL_REPLICATION + pad(tokenId) },
	]);
	const hex = res[tokenId];
	if (hex instanceof Error) throw hex;
	return decodeMask(hex, tokenId);
}

/// --verify: sample tokens and cross-check the committed table
/// against BOTH independent sources (chain flags, metadata's
/// "total traits burned" count).
async function verify(sampleSize) {
	if (!fs.existsSync(OUT_FILE)) {
		throw new Error("burned.json missing - run the capture first");
	}
	const table = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
	let failures = 0;
	for (let i = 0; i < sampleSize; i++) {
		const tokenId = Math.floor(Math.random() * PRIME_COUNT);
		const stored = table[tokenId] || 0;
		const chain = await chainMask(tokenId);
		let metaBurned = null;
		try {
			const meta = await (
				await fetch(`https://avastars.io/metadata/${tokenId}`)
			).json();
			const attr = (meta.attributes || []).find(
				(a) => a.trait_type === "total traits burned",
			);
			metaBurned = attr ? Number(attr.value) : 0;
		} catch (error) {
			console.warn(`token ${tokenId}: metadata unavailable, chain-only check`);
		}
		const ok =
			stored === chain &&
			(metaBurned === null || popcount(chain) === metaBurned);
		if (!ok) failures++;
		console.log(
			`token ${tokenId}: stored=${stored} chain=${chain}` +
				(metaBurned === null ? "" : ` metaCount=${metaBurned}`) +
				(ok ? "" : "  MISMATCH"),
		);
		await sleep(400);
	}
	console.log(
		failures === 0 ? "verify: all match" : `verify: ${failures} MISMATCHES`,
	);
	if (failures > 0) process.exitCode = 1;
}

async function capture() {
	fs.mkdirSync(DATA_DIR, { recursive: true });
	const progress = fs.existsSync(PROGRESS_FILE)
		? JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"))
		: { through: 0, masks: {}, failed: [] };
	progress.failed = progress.failed || [];
	console.log(
		`capturing primes ${progress.through}..${PRIME_COUNT - 1} ` +
			`(${Object.keys(progress.masks).length} burns recorded so far, ` +
			`${progress.failed.length} pending retries)`,
	);
	// A token that fails past the batch retries is RECORDED, not
	// just counted: `through` advances regardless, so without the
	// list a re-run would sail past the gap and finalize a table
	// silently missing those burns
	const record = (tokenId, hex) => {
		if (hex instanceof Error) {
			console.warn(`token ${tokenId}: ${hex.message}`);
			progress.failed.push(tokenId);
			return;
		}
		const mask = decodeMask(hex, tokenId);
		if (mask > 0) progress.masks[tokenId] = mask;
	};
	for (let start = progress.through; start < PRIME_COUNT; start += BATCH_SIZE) {
		const chunk = [];
		for (let t = start; t < Math.min(start + BATCH_SIZE, PRIME_COUNT); t++) {
			chunk.push(t);
		}
		const results = await rpcBatch(
			chunk.map((t) => ({ id: t, data: SEL_REPLICATION + pad(t) })),
		);
		for (const t of chunk) {
			record(t, results[t]);
		}
		progress.through = Math.min(start + BATCH_SIZE, PRIME_COUNT);
		if (progress.through % (BATCH_SIZE * 10) < BATCH_SIZE) {
			fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress));
			console.log(
				`progress: ${progress.through}/${PRIME_COUNT} ` +
					`(${Object.keys(progress.masks).length} with burns; saved)`,
			);
		}
		await sleep(BATCH_DELAY_MS);
	}
	// Give the recorded failures one more pass (a resumed run with
	// `through` already complete lands here directly)
	if (progress.failed.length > 0) {
		const retryIds = [...new Set(progress.failed)];
		console.log(`retrying ${retryIds.length} failed tokens...`);
		progress.failed = [];
		const results = await rpcBatch(
			retryIds.map((t) => ({ id: t, data: SEL_REPLICATION + pad(t) })),
		);
		for (const t of retryIds) {
			record(t, results[t]);
		}
	}
	if (progress.failed.length > 0) {
		fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress));
		throw new Error(
			`${progress.failed.length} tokens still failing - re-run to ` +
				`retry them (progress kept)`,
		);
	}
	// Deterministic final table: numeric-ascending keys, sparse
	const table = {};
	for (const key of Object.keys(progress.masks)
		.map(Number)
		.sort((a, b) => a - b)) {
		table[key] = progress.masks[key];
	}
	fs.writeFileSync(OUT_FILE, JSON.stringify(table));
	fs.rmSync(PROGRESS_FILE, { force: true });
	const totalBurns = Object.values(table).reduce((a, m) => a + popcount(m), 0);
	console.log(
		`done: ${Object.keys(table).length} primes with burns, ` +
			`${totalBurns} traits burned total -> ${OUT_FILE}`,
	);
}

const verifyArg = process.argv.indexOf("--verify");
(verifyArg >= 0
	? verify(Number(process.argv[verifyArg + 1]) || 20)
	: capture()
).catch((e) => {
	console.error("FAILED:", e.message);
	process.exit(1);
});
