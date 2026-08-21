// TAD Step 3 (docs/tads/trait-composition.md): prove the extracted
// library generalizes. Compose HELD-OUT tokens (never part of the
// extraction coverage set) purely from Traits/ + their trait hash,
// fetch the live renderAvastar output, and require byte equality.
//
// Usage: AVASTARS_RPC_URL=<endpoint> node Tools/validate-composition.js [--sample 100]
const fs = require("fs");
const path = require("path");

const RPC = process.env.AVASTARS_RPC_URL;
if (!RPC) {
	console.error("AVASTARS_RPC_URL not set");
	process.exit(1);
}
const CONTRACT = "0xF3E778F839934fC819cFA1040AabaCeCBA01e049";
const SEL = { renderAvastar: "0x2ff640b5" };
const DATA_DIR = path.join(__dirname, "data");
const RENDERS_DIR = path.join(DATA_DIR, "renders");
const TRAITS_DIR = path.join(__dirname, "..", "Traits");
const GENE_COUNT = 12;

const sampleArg = process.argv.indexOf("--sample");
const SAMPLE = sampleArg >= 0 ? Number(process.argv[sampleArg + 1]) : 100;
const offsetArg = process.argv.indexOf("--offset");
const OFFSET = offsetArg >= 0 ? Number(process.argv[offsetArg + 1]) : 0;
if (!Number.isInteger(SAMPLE) || SAMPLE <= 0) {
	console.error("--sample requires a positive integer");
	process.exit(1);
}
if (!Number.isInteger(OFFSET) || OFFSET < 0) {
	console.error("--offset requires a non-negative integer");
	process.exit(1);
}
// --absorb: save mismatching on-chain renders into the extraction
// corpus so the next extract-traits run learns from them
const ABSORB = process.argv.includes("--absorb");

const pad = (n) => BigInt(n).toString(16).padStart(64, "0");
const num = (hex, i) => BigInt("0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function decodeString(hex, slot = 0) {
	const off = Number(num(hex, slot)) / 32;
	const len = Number(num(hex, off));
	return Buffer.from(
		hex.slice(2 + (off + 1) * 64, 2 + (off + 1) * 64 + len * 2),
		"hex"
	).toString("utf8");
}
async function ethCall(data) {
	for (let attempt = 0; ; attempt++) {
		try {
			const res = await fetch(RPC, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0", id: 1, method: "eth_call",
					params: [{ to: CONTRACT, data }, "latest"],
				}),
			});
			if (res.status === 429) throw new Error("rate limited");
			const json = await res.json();
			if (json.error) throw new Error(json.error.message);
			return json.result;
		} catch (error) {
			if (attempt >= 5) throw error;
			await sleep(1200 * Math.pow(1.7, attempt));
		}
	}
}

function variationsOf(entry) {
	const traits = BigInt(entry.traits);
	const out = [];
	for (let gene = 0; gene < GENE_COUNT; gene++) {
		out.push(Number((traits >> BigInt(gene * 8)) & 0xffn));
	}
	return out;
}

async function main() {
	const hashes = JSON.parse(
		fs.readFileSync(path.join(DATA_DIR, "hashes.json"), "utf8")
	);
	const { header, footer } = JSON.parse(
		fs.readFileSync(path.join(TRAITS_DIR, "compose.json"), "utf8")
	);
	const index = JSON.parse(
		fs.readFileSync(path.join(TRAITS_DIR, "index.json"), "utf8")
	);
	// (generation:gene:variation) -> fragment
	const fragByKey = new Map();
	for (const [traitId, info] of Object.entries(index)) {
		fragByKey.set(
			`${info.generation}:${info.gene}:${info.variation}`,
			fs.readFileSync(
				path.join(TRAITS_DIR, String(info.generation), traitId + ".svg"),
				"utf8"
			)
		);
	}
	// Held-out = not in the committed extraction manifest. The
	// gitignored render cache is unioned in when present so tokens
	// absorbed mid-iteration (before the manifest is regenerated)
	// are never miscounted as held-out.
	const usedInExtraction = new Set(
		JSON.parse(
			fs.readFileSync(path.join(TRAITS_DIR, "extraction-tokens.json"), "utf8")
		).map(String)
	);
	if (fs.existsSync(RENDERS_DIR)) {
		for (const f of fs.readdirSync(RENDERS_DIR)) {
			usedInExtraction.add(f.replace(".svg", ""));
		}
	}
	const candidates = Object.keys(hashes).filter((t) => !usedInExtraction.has(t));
	// Deterministic sample: evenly spaced across the id range
	const step = Math.max(1, Math.floor(candidates.length / SAMPLE));
	const sample = [];
	for (let i = OFFSET; i < candidates.length && sample.length < SAMPLE; i += step) {
		sample.push(candidates[i]);
	}
	console.log(`validating ${sample.length} held-out tokens (of ${candidates.length} never seen by extraction)`);

	let pass = 0, fail = 0, skip = 0;
	for (const tokenId of sample) {
		const entry = hashes[tokenId];
		const variations = variationsOf(entry);
		let composed = header;
		let missingTrait = null;
		for (let gene = 0; gene < GENE_COUNT; gene++) {
			const key = `${entry.generation}:${gene}:${variations[gene]}`;
			const frag = fragByKey.get(key);
			if (frag === undefined) { missingTrait = key; break; }
			composed += frag;
		}
		if (missingTrait) {
			skip++;
			console.warn(`token ${tokenId}: trait ${missingTrait} not in library (SKIP)`);
			continue;
		}
		composed += footer;
		const onChain = decodeString(await ethCall(SEL.renderAvastar + pad(tokenId)));
		if (composed === onChain) {
			pass++;
		} else {
			fail++;
			if (ABSORB) {
				fs.writeFileSync(path.join(RENDERS_DIR, tokenId + ".svg"), onChain);
			}
			if (fail <= 5) {
				let i = 0;
				while (i < Math.min(composed.length, onChain.length) && composed[i] === onChain[i]) i++;
				console.error(
					`token ${tokenId}: MISMATCH len ${composed.length} vs ${onChain.length}, first diff @${i}: ` +
					`composed "${composed.slice(i, i + 60)}" vs chain "${onChain.slice(i, i + 60)}"`
				);
			}
		}
		if ((pass + fail + skip) % 20 === 0) {
			console.log(`progress: ${pass + fail + skip}/${sample.length} (${pass} pass, ${fail} fail, ${skip} skip)`);
		}
		await sleep(200);
	}
	console.log(`RESULT: ${pass} pass, ${fail} fail, ${skip} skip of ${sample.length}`);
	if (fail > 0 || skip > 0) process.exitCode = 1;
}

main().catch((e) => {
	console.error("FAILED:", e.message);
	process.exit(1);
});
