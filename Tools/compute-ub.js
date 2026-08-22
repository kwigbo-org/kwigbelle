#!/usr/bin/env node
// Precompute Unique-By combo counts (docs/tads/design-cues.md
// Decision 6): for each LOTTERY PRIME (#200-25199 - founders,
// exclusives, and replicants did not play the same mint lottery
// and are excluded from both the population and the metric), count
// the trait pairs (u2) and triples (u3), over all 12 genes, worn
// by no other lottery prime. The corpus is frozen (contract
// locked), so this runs once and the output never changes.
//
// Usage: node Tools/compute-ub.js   (writes Tools/data/ub.json)
//
// Self-checks (the output is committed and displayed forever):
// - determinism: keys emitted in ascending token order
// - u2 <= C(12,2)=66, u3 <= C(12,3)=220
// - any token with a unique pair has >= 10 unique triples (each of
//   its 10 other traits extends the pair into a unique triple)
const fs = require("fs");
const path = require("path");

const START = 200;
const END = 25200; // exclusive; last lottery prime is 25199

const hashes = JSON.parse(
	fs.readFileSync(path.join(__dirname, "data", "hashes.json"), "utf8"),
);

// Gene-ordered variation bytes (gene 0 = last byte of the hash)
const picks = new Map();
for (let id = START; id < END; id++) {
	const entry = hashes[id];
	if (!entry || entry.kind !== "prime") {
		throw new Error(`token ${id} missing or not a prime - corpus damaged?`);
	}
	const hex = entry.traits.replace("0x", "");
	const bytes = [];
	for (let i = 0; i < hex.length; i += 2) {
		bytes.push(parseInt(hex.slice(i, i + 2), 16));
	}
	picks.set(id, bytes.reverse().slice(0, 12));
}

// Numeric combo keys: (gene*256+variation) is 12 bits; pairs pack
// into 32 bits, triples into 48 (safe integer range)
const key1 = (gene, variation) => gene * 256 + variation;
const pairs = new Map();
const triples = new Map();
for (const p of picks.values()) {
	for (let a = 0; a < 12; a++) {
		for (let b = a + 1; b < 12; b++) {
			const pairKey = key1(a, p[a]) * 65536 + key1(b, p[b]);
			pairs.set(pairKey, (pairs.get(pairKey) || 0) + 1);
			for (let c = b + 1; c < 12; c++) {
				const tripleKey = pairKey * 65536 + key1(c, p[c]);
				triples.set(tripleKey, (triples.get(tripleKey) || 0) + 1);
			}
		}
	}
}

const result = {};
let tokensWithU2 = 0;
for (let id = START; id < END; id++) {
	const p = picks.get(id);
	let u2 = 0;
	let u3 = 0;
	for (let a = 0; a < 12; a++) {
		for (let b = a + 1; b < 12; b++) {
			const pairKey = key1(a, p[a]) * 65536 + key1(b, p[b]);
			if (pairs.get(pairKey) === 1) {
				u2++;
			}
			for (let c = b + 1; c < 12; c++) {
				if (triples.get(pairKey * 65536 + key1(c, p[c])) === 1) {
					u3++;
				}
			}
		}
	}
	if (u2 > 66 || u3 > 220) {
		throw new Error(`token ${id}: impossible counts u2=${u2} u3=${u3}`);
	}
	if (u2 > 0 && u3 < 10) {
		throw new Error(
			`token ${id}: invariant broken - u2=${u2} demands u3>=10, got ${u3}`,
		);
	}
	if (u2 > 0) {
		tokensWithU2++;
	}
	result[id] = { u2, u3 };
}

const outPath = path.join(__dirname, "data", "ub.json");
fs.writeFileSync(outPath, JSON.stringify(result));
console.log(`wrote ${Object.keys(result).length} lottery primes to ${outPath}`);
console.log(`${tokensWithU2} tokens carry at least one unique pair`);
console.log(
	"anchors:",
	JSON.stringify({ 8014: result[8014], 8184: result[8184], 200: result[200] }),
);
