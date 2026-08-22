// Corpus freshness check (docs/tads/retire-legacy.md): the site
// composes from Tools/data/hashes.json, a snapshot of every minted
// token's trait hash. A token minted after the snapshot cannot be
// composed until the corpus is refreshed and redeployed. This
// compares on-chain totalSupply against the snapshot.
//
// Usage:
//   AVASTARS_RPC_URL=<endpoint> node Tools/check-corpus.js            # check only
//   AVASTARS_RPC_URL=<endpoint> node Tools/check-corpus.js --update   # refresh via fetch-hashes.js
//
// Exit codes: 0 fresh (or updated), 1 stale, 2 unable to check.
// deploy.sh runs the check warn-only when AVASTARS_RPC_URL is set.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RPC = process.env.AVASTARS_RPC_URL;
const CONTRACT = "0xF3E778F839934fC819cFA1040AabaCeCBA01e049";
const TOTAL_SUPPLY_SELECTOR = "0x18160ddd";
const HASHES_PATH = path.join(__dirname, "data", "hashes.json");

async function totalSupply() {
	const res = await fetch(RPC, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "eth_call",
			params: [{ to: CONTRACT, data: TOTAL_SUPPLY_SELECTOR }, "latest"],
		}),
	});
	const json = await res.json();
	if (json.error) {
		throw new Error(json.error.message);
	}
	return Number(BigInt(json.result));
}

async function main() {
	if (!RPC) {
		console.error(
			"AVASTARS_RPC_URL is not set (tooling-only env var; see CLAUDE.md)",
		);
		process.exit(2);
	}
	const corpus = Object.keys(
		JSON.parse(fs.readFileSync(HASHES_PATH, "utf8")),
	).length;
	const supply = await totalSupply();
	if (supply === corpus) {
		console.log(`corpus fresh: ${corpus} tokens matches on-chain totalSupply`);
		return;
	}
	console.warn(
		`corpus STALE: on-chain totalSupply is ${supply}, corpus has ${corpus} - ` +
			`${supply - corpus} token(s) minted since the snapshot cannot be composed`,
	);
	if (!process.argv.includes("--update")) {
		console.warn("refresh with: node Tools/check-corpus.js --update");
		process.exit(1);
	}
	// fetch-hashes.js is resumable: it skips tokens already in the
	// corpus and fetches only the missing ids
	const run = spawnSync(
		process.execPath,
		[path.join(__dirname, "fetch-hashes.js")],
		{ stdio: "inherit" },
	);
	if (run.status !== 0) {
		process.exit(run.status === null ? 2 : run.status);
	}
	console.log(
		[
			"corpus updated. Before deploying:",
			"  1. node Tools/validate-composition.js   (parity for the new ids;",
			"     a failure means new trait art exists - rebuild the library",
			"     with Tools/extract-traits.js using the failures as evidence)",
			"  2. ./deploy.sh (hashes.json ships with the site)",
		].join("\n"),
	);
}

main().catch((error) => {
	console.error(`corpus check failed: ${error.message || error}`);
	process.exit(2);
});
