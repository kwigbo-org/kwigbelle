// TAD Step 2 (docs/tads/trait-composition.md, Decision 7):
// build the per-trait SVG fragment library from a coverage set of
// full renderAvastar outputs, since getTraitArtById is role-gated.
//
// Method:
//   1. From Tools/data/hashes.json, bucket tokens by trait
//      (generation, gene, variation) and pick a coverage set where
//      every trait appears in >=2 tokens (or all it has).
//      Deliberately include Hamming-1 pairs (tokens differing in
//      exactly one gene) - they bootstrap fragment discovery.
//   2. Fetch those renders (resumable, Tools/data/renders/).
//   3. Header/footer = longest common prefix/suffix across renders.
//   4. Hamming-1 pairs isolate single-gene fragments (diff between
//      the two bodies, snapped to SVG element boundaries).
//   5. Propagation: locate known fragments in each body; a bounded
//      gap attributable to exactly one unknown trait becomes that
//      trait's fragment. Repeat until no progress.
//   6. Cross-validation: every render must partition EXACTLY into
//      header + its 12 fragments (in discovered gene order) +
//      footer. Any residue fails the run.
//   7. Fetch trait ids + info (public views), write
//      Traits/<gen>/<traitId>.svg + Traits/index.json (sha256 per
//      fragment backs --verify).
//
// Usage: AVASTARS_RPC_URL=<endpoint> node Tools/extract-traits.js [--verify]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RPC = process.env.AVASTARS_RPC_URL;
const CONTRACT = "0xF3E778F839934fC819cFA1040AabaCeCBA01e049";
const SEL = {
	renderAvastar: "0x2ff640b5",
	getTraitIdByGenerationGeneAndVariation: "0x4001a267",
	getTraitInfoById: "0xf0a5e6c6",
};
const DATA_DIR = path.join(__dirname, "data");
const RENDERS_DIR = path.join(DATA_DIR, "renders");
const TRAITS_DIR = path.join(__dirname, "..", "Traits");
const VERIFY = process.argv.includes("--verify");

const GENE_NAMES = [
	"Skin Tone",
	"Hair Color",
	"Eye Color",
	"BG Color",
	"Backdrop",
	"Ears",
	"Face",
	"Nose",
	"Mouth",
	"Facial Feature",
	"Eyes",
	"Hair Style",
];
const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
const GENE_COUNT = 12;

const pad = (n) => BigInt(n).toString(16).padStart(64, "0");
const word = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const num = (hex, i) => BigInt("0x" + word(hex, i));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function decodeString(hex, slot = 0) {
	const off = Number(num(hex, slot)) / 32;
	const len = Number(num(hex, off));
	return Buffer.from(
		hex.slice(2 + (off + 1) * 64, 2 + (off + 1) * 64 + len * 2),
		"hex",
	).toString("utf8");
}

async function ethCall(data) {
	for (let attempt = 0; ; attempt++) {
		try {
			const res = await fetch(RPC, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "eth_call",
					params: [{ to: CONTRACT, data }, "latest"],
				}),
			});
			if (res.status === 429) throw new Error("rate limited");
			const json = await res.json();
			if (json.error) throw new Error(json.error.message);
			return json.result;
		} catch (error) {
			if (attempt >= 4) throw error;
			await sleep(1000 * Math.pow(2, attempt));
		}
	}
}

// ---- trait keys ----
const keyOf = (gen, gene, variation) => `${gen}:${gene}:${variation}`;
function variationsOf(entry) {
	const traits = BigInt(entry.traits);
	const out = [];
	for (let gene = 0; gene < GENE_COUNT; gene++) {
		out.push(Number((traits >> BigInt(gene * 8)) & 0xffn));
	}
	return out;
}

// ---- coverage selection ----
function selectCoverage(hashes) {
	const byTrait = new Map(); // key -> [tokenId]
	const tokenTraits = new Map(); // tokenId -> [key x12]
	for (const [tokenId, entry] of Object.entries(hashes)) {
		const keys = variationsOf(entry).map((v, g) =>
			keyOf(entry.generation, g, v),
		);
		tokenTraits.set(tokenId, keys);
		for (const k of keys) {
			if (!byTrait.has(k)) byTrait.set(k, []);
			byTrait.get(k).push(tokenId);
		}
	}
	// Hamming-1 pairs per gene: bucket by hash with one gene masked
	const pairs = [];
	const seenPair = new Set();
	for (let gene = 0; gene < GENE_COUNT; gene++) {
		const buckets = new Map();
		for (const [tokenId, entry] of Object.entries(hashes)) {
			const keys = tokenTraits.get(tokenId).slice();
			keys[gene] = "*";
			const bucketKey = entry.generation + "|" + keys.join(",");
			if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
			buckets.get(bucketKey).push(tokenId);
		}
		let found = 0;
		for (const list of buckets.values()) {
			// Only tokens whose gene-variations actually differ pair up
			for (let i = 1; i < list.length && found < 6; i++) {
				const a = list[0],
					b = list[i];
				if (tokenTraits.get(a)[gene] === tokenTraits.get(b)[gene]) continue;
				const pk = a + "|" + b;
				if (seenPair.has(pk)) continue;
				seenPair.add(pk);
				pairs.push({ gene, a, b });
				found++;
			}
			if (found >= 6) break;
		}
		console.log(`gene ${gene} (${GENE_NAMES[gene]}): ${found} Hamming-1 pairs`);
	}
	// Greedy cover: every trait in >=2 tokens (or all it has)
	const need = new Map();
	for (const [k, tokens] of byTrait) need.set(k, Math.min(2, tokens.length));
	const chosen = new Set();
	for (const p of pairs) {
		chosen.add(p.a);
		chosen.add(p.b);
	}
	const creditToken = (tokenId) => {
		for (const k of tokenTraits.get(tokenId)) {
			need.set(k, Math.max(0, need.get(k) - 1));
		}
	};
	for (const t of chosen) creditToken(t);
	// Rarest-first
	const traitOrder = [...byTrait.entries()].sort(
		(x, y) => x[1].length - y[1].length,
	);
	for (const [k, tokens] of traitOrder) {
		while (need.get(k) > 0) {
			// token covering this trait with max residual need elsewhere
			let best = null,
				bestScore = -1;
			for (const t of tokens) {
				if (chosen.has(t)) continue;
				let score = 0;
				for (const tk of tokenTraits.get(t)) score += need.get(tk) > 0 ? 1 : 0;
				if (score > bestScore) {
					bestScore = score;
					best = t;
				}
			}
			if (best === null) break; // no more tokens carry this trait
			chosen.add(best);
			creditToken(best);
		}
	}
	const uncovered = [...need.entries()].filter(([, n]) => n > 0);
	console.log(
		`traits: ${byTrait.size}; coverage set: ${chosen.size} tokens; single-source traits: ${uncovered.length}`,
	);
	return { chosen: [...chosen], tokenTraits, byTrait, pairs };
}

// ---- fetch renders ----
async function fetchRenders(tokenIds) {
	fs.mkdirSync(RENDERS_DIR, { recursive: true });
	let fetched = 0;
	for (const tokenId of tokenIds) {
		const file = path.join(RENDERS_DIR, tokenId + ".svg");
		if (!VERIFY && fs.existsSync(file)) continue;
		const hex = await ethCall(SEL.renderAvastar + pad(tokenId));
		fs.writeFileSync(file, decodeString(hex));
		fetched++;
		if (fetched % 25 === 0) console.log(`renders: ${fetched} fetched`);
		await sleep(150);
	}
	console.log(`renders ready (${fetched} newly fetched)`);
}

// ---- extraction primitives ----
// All extraction happens at TOP-LEVEL-ELEMENT granularity: bodies
// are tokenized into complete top-level SVG elements, fragments are
// contiguous element runs, and diffs/locates/partitions operate on
// element arrays. This removes the character-level boundary
// ambiguity that made pairwise diffs steal neighbor bytes.

// Index just past the '>' closing the tag opened at s[i], honoring
// quoted attribute values.
function tagEnd(s, i) {
	let quote = null;
	for (let j = i + 1; j < s.length; j++) {
		const c = s[j];
		if (quote) {
			if (c === quote) quote = null;
		} else if (c === '"' || c === "'") {
			quote = c;
		} else if (c === ">") {
			return j + 1;
		}
	}
	return s.length;
}

// Split a body into complete top-level elements (style/script get
// raw-text handling: their content is not markup).
function splitTopLevel(s) {
	const els = [];
	let i = 0;
	while (i < s.length) {
		if (s[i] !== "<") {
			let j = s.indexOf("<", i);
			if (j === -1) j = s.length;
			const text = s.slice(i, j);
			if (text.trim() !== "") els.push(text);
			else if (els.length > 0) els[els.length - 1] += text;
			i = j;
			continue;
		}
		const start = i;
		let depth = 0;
		while (i < s.length) {
			if (s.startsWith("<!--", i)) {
				const e = s.indexOf("-->", i);
				i = e === -1 ? s.length : e + 3;
				if (depth === 0) break;
				continue;
			}
			const isClose = s[i + 1] === "/";
			const m = /^<\/?([A-Za-z][\w:-]*)/.exec(s.slice(i, i + 64));
			const name = m ? m[1].toLowerCase() : "";
			const end = tagEnd(s, i);
			const selfClose = !isClose && s[end - 2] === "/";
			i = end;
			if (isClose) {
				depth--;
			} else if (!selfClose) {
				if (name === "style" || name === "script") {
					const e = s.indexOf("</" + name, i);
					i = e === -1 ? s.length : tagEnd(s, e);
				} else {
					depth++;
					continue;
				}
			}
			if (depth <= 0) break;
		}
		els.push(s.slice(start, i));
	}
	return els;
}

function commonPrefixLen(a, b) {
	let i = 0;
	const n = Math.min(a.length, b.length);
	while (i < n && a[i] === b[i]) i++;
	return i;
}
function commonSuffixLen(a, b, maxLen) {
	let i = 0;
	const n = Math.min(a.length, b.length, maxLen);
	while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
	return i;
}
// First index where subarray `sub` occurs contiguously in `arr`, or -1
function indexOfSub(arr, sub, from = 0) {
	if (sub.length === 0) return -1;
	outer: for (let i = from; i + sub.length <= arr.length; i++) {
		for (let j = 0; j < sub.length; j++) {
			if (arr[i + j] !== sub[j]) continue outer;
		}
		return i;
	}
	return -1;
}

// Strip the outer <svg ...> wrapper; returns { open, inner, close }
function unwrapDocument(svg) {
	const svgAt = svg.indexOf("<svg");
	const open = tagEnd(svg, svgAt);
	const closeAt = svg.lastIndexOf("</svg");
	if (svgAt < 0 || closeAt < 0) throw new Error("no <svg> wrapper found");
	return {
		open: svg.slice(0, open),
		inner: svg.slice(open, closeAt),
		close: svg.slice(closeAt),
	};
}

function extractFragments(renderOf, coverage) {
	const { chosen, tokenTraits, byTrait, pairs } = coverage;
	// Unwrap the document, then tokenize the inner content into
	// top-level elements. The wrapper must be constant across
	// renders (it becomes part of the composer's fixed header).
	const elsOf = new Map();
	let docOpen = null,
		docClose = null;
	for (const t of chosen) {
		const { open, inner, close } = unwrapDocument(renderOf(t));
		if (docOpen === null) {
			docOpen = open;
			docClose = close;
		} else if (docOpen !== open || docClose !== close) {
			throw new Error(`non-constant <svg> wrapper on token ${t}`);
		}
		elsOf.set(t, splitTopLevel(inner));
	}
	console.log(
		`document wrapper: open ${docOpen.length}B, close ${docClose.length}B (constant)`,
	);
	const all = chosen.map((t) => elsOf.get(t));
	let headerN = all[0].length;
	for (const els of all)
		headerN = Math.min(headerN, commonPrefixLen(all[0], els));
	let footerN = all[0].length - headerN;
	for (const els of all)
		footerN = Math.min(
			footerN,
			commonSuffixLen(all[0], els, els.length - headerN),
		);
	const header = docOpen + all[0].slice(0, headerN).join("");
	const footer =
		(footerN > 0 ? all[0].slice(-footerN).join("") : "") + docClose;
	console.log(
		`header ${headerN} common element(s), ${header.length}B total; footer ${footerN} element(s), ${footer.length}B total`,
	);
	const bodies = new Map();
	for (const t of chosen) {
		const els = elsOf.get(t);
		bodies.set(t, els.slice(headerN, els.length - footerN));
	}
	// Renders in the coverage set carrying a given trait
	const carriersOf = (key) =>
		(byTrait.get(key) || []).filter((t) => bodies.has(t));
	// A candidate fragment (element array) is sound iff it appears
	// contiguously in every coverage render carrying the trait
	const appearsInAll = (key, frag) =>
		carriersOf(key).every((t) => indexOfSub(bodies.get(t), frag) >= 0);

	const known = new Map(); // traitKey -> element array
	const setKnown = (key, frag) => {
		// EVERY candidate must appear contiguously in every carrier
		// (first-time assignments included - a propagation gap can
		// contain a neighbor's untagged tail, and accepting it
		// unchecked poisons every other render with that trait)
		if (frag.length > 0 && !appearsInAll(key, frag)) {
			return;
		}
		if (!known.has(key)) {
			known.set(key, frag);
			return;
		}
		const old = known.get(key);
		if (old.join("") === frag.join("")) return;
		// Conflict: ties go to the LONGER candidate. Pair diffs and
		// cores UNDER-extend (constant edge elements land in the
		// common region / untagged margins), so a longer candidate
		// that still appears in every carrier is more complete.
		const oldOk = old.length === 0 || appearsInAll(key, old);
		if (!oldOk) {
			known.set(key, frag);
			return;
		}
		known.set(key, old.length >= frag.length ? old : frag);
	};

	// Mass seeding via id/url gene tagging: art elements name their
	// gene through ids (`<pattern id="nose_k"`) and references
	// (`url(#feat_o)`, `xlink:href="#backdrop_e"`). CSS classes are
	// deliberately IGNORED - trait art reuses other genes' classes
	// (e.g. feature art styled with hair_*). Per render and gene,
	// the first-tagged..last-tagged span seeds a CORE fragment;
	// repair extends cores over untagged margins later.
	const ART_PREFIX = {
		backdrop: 4,
		ear: 5,
		face: 6,
		nose: 7,
		mouth: 8,
		feat: 9,
		eye: 10,
		hair: 11,
	};
	const STYLE_MARKERS = [".skin_", ".hair_", ".eye_", ".bg_"];
	const tagGene = (el) => {
		const genes = new Set();
		for (const re of [
			/\bid="([A-Za-z]+)_/g,
			/url\(#([A-Za-z]+)_/g,
			/href="#([A-Za-z]+)_/g,
		]) {
			for (const m of el.matchAll(re)) {
				const g = ART_PREFIX[m[1].toLowerCase()];
				if (g !== undefined) genes.add(g);
			}
		}
		return genes.size === 1 ? [...genes][0] : null; // conflicts stay untagged
	};
	for (const t of chosen) {
		const body = bodies.get(t);
		const keys = tokenTraits.get(t);
		// Color genes 0-3: the four leading style blocks, one each
		let styleOk = true;
		for (let g = 0; g < 4; g++) {
			const el = body[g];
			if (!el || !el.startsWith("<style") || !el.includes(STYLE_MARKERS[g])) {
				styleOk = false;
				break;
			}
		}
		if (!styleOk) {
			console.warn(
				`token ${t}: unexpected style block layout, skipping style seeds`,
			);
		} else {
			for (let g = 0; g < 4; g++) setKnown(keys[g], [body[g]]);
		}
		// Art genes: first..last tagged element per gene
		const first = {},
			last = {};
		for (let i = 4; i < body.length; i++) {
			const g = tagGene(body[i]);
			if (g === null) continue;
			if (first[g] === undefined) first[g] = i;
			last[g] = i;
		}
		for (const [g, s] of Object.entries(first)) {
			setKnown(keys[g], body.slice(s, last[g] + 1));
		}
	}
	console.log(`core seeding: ${known.size} fragments from id/url tagging`);

	// Hamming-1 pairs still contribute (they can capture full
	// fragments including untagged edges the cores miss)
	for (const { gene, a, b } of pairs) {
		const A = bodies.get(a),
			B = bodies.get(b);
		if (A === undefined || B === undefined) continue;
		const p = commonPrefixLen(A, B);
		const s = commonSuffixLen(A, B, Math.min(A.length, B.length) - p);
		setKnown(tokenTraits.get(a)[gene], A.slice(p, A.length - s));
		setKnown(tokenTraits.get(b)[gene], B.slice(p, B.length - s));
	}
	console.log(`after Hamming-1 bootstrap: ${known.size} fragments`);

	// Order-aware walk of one render. Genes emit in gene-id order
	// (verified empirically - the four color styles then art in
	// gene order). Returns segments needing work:
	//   unknownRun - elements between anchors owned by unknown genes
	//   orphan     - unclaimed elements BETWEEN two known anchors,
	//                caused by gene-constant edge elements that
	//                pairwise diffs attribute to the common region
	const walk = (t) => {
		const body = bodies.get(t);
		const keys = tokenTraits.get(t);
		const segments = [];
		let cursor = 0;
		let pendingUnknown = [];
		let lastAnchor = -1;
		for (let g = 0; g <= keys.length; g++) {
			const frag = g < keys.length ? known.get(keys[g]) : null; // null = END sentinel
			if (frag === undefined) {
				pendingUnknown.push(g);
				continue;
			}
			if (frag !== null && frag.length === 0) continue; // empty known: no anchor info
			const idx = frag === null ? body.length : indexOfSub(body, frag, cursor);
			if (idx < 0) return { fail: `locate gene ${g}` };
			if (idx > cursor) {
				segments.push(
					pendingUnknown.length > 0
						? {
								type: "unknownRun",
								genes: [...pendingUnknown],
								span: [cursor, idx],
							}
						: {
								type: "orphan",
								left: lastAnchor,
								right: g,
								span: [cursor, idx],
							},
				);
			} else if (pendingUnknown.length > 0) {
				segments.push({
					type: "unknownRun",
					genes: [...pendingUnknown],
					span: [cursor, cursor],
				});
			}
			pendingUnknown = [];
			if (frag !== null) {
				cursor = idx + frag.length;
				lastAnchor = g;
			} else {
				cursor = idx;
			}
		}
		return { segments, keys, body };
	};

	// Alternate repair (reattach orphans to a neighbor, right-head
	// preferred, consensus-validated) and propagation (assign a
	// single-unknown run its span) until fixpoint. Runs inside an
	// outer cycle with reconciliation: overrides expose new orphans
	// and vice versa, so the phases must iterate together.
	// Tile one render; returns null on success or break info
	const tileCheck = (t) => {
		const body = bodies.get(t);
		const keys = tokenTraits.get(t);
		let cursor = 0;
		for (let g = 0; g < keys.length; g++) {
			const frag = known.get(keys[g]);
			if (frag === undefined) return { t, g, cursor, missing: keys[g] };
			if (frag.length === 0) continue;
			const idx = indexOfSub(body, frag, cursor);
			if (idx !== cursor) return { t, g, cursor };
			cursor += frag.length;
		}
		if (cursor !== body.length) return { t, g: keys.length, cursor };
		return null;
	};

	let cycleProgress = true;
	for (let cycle = 0; cycle < 20 && cycleProgress; cycle++) {
		cycleProgress = false;
		for (let round = 0; round < 100; round++) {
			let progress = false;
			for (const t of chosen) {
				const res = walk(t);
				if (res.fail) continue;
				for (const seg of res.segments) {
					const piece = res.body.slice(seg.span[0], seg.span[1]);
					if (seg.type === "unknownRun") {
						if (seg.genes.length !== 1) continue;
						const key = res.keys[seg.genes[0]];
						if (!known.has(key)) {
							setKnown(key, piece);
							progress = true;
						}
					} else {
						// Orphan between two known anchors. May be MIXED:
						// the left gene's clipped tail followed by the
						// right gene's clipped head. Try every split
						// point; accept one where both sides validate
						// across their carriers. k = piece.length is
						// "all to left tail", k = 0 is "all to right
						// head" (tried first: constant lead patterns
						// like eye_i naturally head their own gene).
						const rightKey =
							seg.right < res.keys.length ? res.keys[seg.right] : null;
						const leftKey = seg.left >= 0 ? res.keys[seg.left] : null;
						let applied = false;
						for (let k = 0; k <= piece.length && !applied; k++) {
							const toLeft = piece.slice(0, k);
							const toRight = piece.slice(k);
							// Guards precede the spreads so a broken
							// anchor invariant skips cleanly instead of
							// spreading undefined
							if (toLeft.length > 0 && (!leftKey || !known.has(leftKey)))
								continue;
							if (toRight.length > 0 && (!rightKey || !known.has(rightKey)))
								continue;
							const candL =
								leftKey && toLeft.length > 0
									? [...known.get(leftKey), ...toLeft]
									: null;
							const candR =
								rightKey && toRight.length > 0
									? [...toRight, ...known.get(rightKey)]
									: null;
							if (candL === null && candR === null) continue;
							if (candL && !appearsInAll(leftKey, candL)) continue;
							if (candR && !appearsInAll(rightKey, candR)) continue;
							if (candL) known.set(leftKey, candL);
							if (candR) known.set(rightKey, candR);
							applied = true;
							progress = true;
						}
					}
				}
			}
			if (!progress) {
				if (round > 0) cycleProgress = true;
				console.log(
					`cycle ${cycle + 1}: repair/propagation converged after ${round} round(s); ${known.size} fragments known`,
				);
				break;
			}
		}

		// Reconciliation: the split-repair resolves each boundary per
		// render, so traits sharing a boundary can adopt INCONSISTENT
		// conventions (constant boundary elements validate on either
		// side). For each failing render, re-derive the breaking
		// trait's fragment from that render's own gap (cursor to the
		// next locatable anchor), carrier-validated, and override.
		for (let round = 0; round < 25; round++) {
			let overrides = 0;
			for (const t of chosen) {
				const brk = tileCheck(t);
				if (!brk || brk.g >= tokenTraits.get(t).length) continue;
				const body = bodies.get(t);
				const keys = tokenTraits.get(t);
				let anchorPos = -1;
				for (let h = brk.g + 1; h < keys.length; h++) {
					const f = known.get(keys[h]);
					if (f === undefined || f.length === 0) continue;
					const idx = indexOfSub(body, f, brk.cursor);
					if (idx >= 0) anchorPos = idx;
					break;
				}
				if (anchorPos < 0) anchorPos = body.length;
				const candidate = body.slice(brk.cursor, anchorPos);
				const key = keys[brk.g];
				if (
					candidate.join("") !== (known.get(key) || []).join("") &&
					(candidate.length === 0 || appearsInAll(key, candidate))
				) {
					known.set(key, candidate);
					overrides++;
				}
			}
			if (overrides === 0) break;
			cycleProgress = true;
			console.log(
				`cycle ${cycle + 1}: reconciliation round ${round + 1}: ${overrides} override(s)`,
			);
		}
	} // outer cycle

	// Full-partition cross-validation: every render must tile as
	// header + fragments in gene order + footer, exactly.
	let failures = 0;
	const missing = new Set();
	for (const t of chosen) {
		const brk = tileCheck(t);
		if (brk) {
			if (brk.missing) missing.add(brk.missing);
			failures++;
			if (failures <= 5)
				console.warn(`partition failure on token ${t} (gene ${brk.g})`);
		}
	}
	if (missing.size > 0) {
		console.warn(
			`unresolved traits (${missing.size}): ${[...missing].slice(0, 12).join(", ")}...`,
		);
	}
	// Dump the working set for offline diagnosis regardless of outcome
	fs.writeFileSync(
		path.join(DATA_DIR, "known-debug.json"),
		JSON.stringify(Object.fromEntries(known)),
	);
	if (failures > 0) {
		throw new Error(
			`${failures}/${chosen.length} renders failed exact partition - extraction unsound (Q5/Decision 7 deep fallback applies)`,
		);
	}
	console.log(
		`cross-validation: all ${chosen.length} renders partition exactly in gene order`,
	);
	// Join to strings for the writer
	const knownStrings = new Map();
	for (const [k, frag] of known) knownStrings.set(k, frag.join(""));
	return { known: knownStrings, header, footer };
}

// ---- trait info + output ----
async function writeLibrary(known) {
	const index = {};
	let done = 0;
	for (const [key, frag] of known) {
		const [gen, gene, variation] = key.split(":").map(Number);
		const tidHex = await ethCall(
			SEL.getTraitIdByGenerationGeneAndVariation +
				pad(gen) +
				pad(gene) +
				pad(variation),
		);
		const traitId = num(tidHex, 0).toString();
		const infoHex = await ethCall(SEL.getTraitInfoById + pad(traitId));
		const rarity = Number(num(infoHex, 5));
		const dir = path.join(TRAITS_DIR, String(gen));
		fs.mkdirSync(dir, { recursive: true });
		const file = path.join(dir, traitId + ".svg");
		const record = {
			generation: gen,
			gene,
			geneName: GENE_NAMES[gene],
			variation,
			rarity,
			rarityName: RARITY_NAMES[rarity] || String(rarity),
			gender: Number(num(infoHex, 3)),
			name: decodeString(infoHex, 7),
			sha256: sha256(frag),
			bytes: frag.length,
		};
		if (VERIFY) {
			const existing = fs.existsSync(file)
				? fs.readFileSync(file, "utf8")
				: null;
			if (existing === null || sha256(existing) !== record.sha256) {
				console.error(`VERIFY MISMATCH: trait ${traitId} (${record.name})`);
				process.exitCode = 1;
			}
		} else {
			fs.writeFileSync(file, frag);
		}
		index[traitId] = record;
		done++;
		if (done % 50 === 0) console.log(`trait info: ${done}/${known.size}`);
		await sleep(60);
	}
	if (!VERIFY) {
		fs.writeFileSync(
			path.join(TRAITS_DIR, "index.json"),
			JSON.stringify(index, null, 1),
		);
	}
	console.log(`${VERIFY ? "verified" : "wrote"} ${done} traits`);
}

async function main() {
	if (!RPC) {
		console.error("AVASTARS_RPC_URL not set");
		process.exit(1);
	}
	const hashes = JSON.parse(
		fs.readFileSync(path.join(DATA_DIR, "hashes.json"), "utf8"),
	);
	const coverage = selectCoverage(hashes);
	await fetchRenders(coverage.chosen);
	// Absorb every cached render as evidence - validation failures
	// saved by validate-composition.js land here and give the
	// extractor the counterexamples it needs to fix boundaries
	if (fs.existsSync(RENDERS_DIR)) {
		const chosenSet = new Set(coverage.chosen);
		for (const f of fs.readdirSync(RENDERS_DIR)) {
			const id = f.replace(".svg", "");
			if (hashes[id] && !chosenSet.has(id)) {
				coverage.chosen.push(id);
				chosenSet.add(id);
			}
		}
		console.log(
			`corpus after absorbing cached renders: ${coverage.chosen.length}`,
		);
	}
	const renderOf = (t) =>
		fs.readFileSync(path.join(RENDERS_DIR, t + ".svg"), "utf8");
	const { known, header, footer } = extractFragments(renderOf, coverage);
	if (!VERIFY) {
		fs.mkdirSync(TRAITS_DIR, { recursive: true });
		fs.writeFileSync(
			path.join(TRAITS_DIR, "compose.json"),
			JSON.stringify({ header, footer }, null, 1),
		);
		// Committed manifest of every token used as extraction
		// evidence: lets validate-composition.js derive a true
		// held-out set on a fresh clone (renders/ is gitignored)
		fs.writeFileSync(
			path.join(TRAITS_DIR, "extraction-tokens.json"),
			JSON.stringify(coverage.chosen.map(Number).sort((a, b) => a - b)),
		);
	}
	await writeLibrary(known);
}

if (require.main === module) {
	main().catch((e) => {
		console.error("FAILED:", e.message);
		process.exit(1);
	});
}

module.exports = {
	splitTopLevel,
	unwrapDocument,
	indexOfSub,
	commonPrefixLen,
	commonSuffixLen,
	selectCoverage,
	variationsOf,
	keyOf,
	GENE_NAMES,
};
