// TAD Step 1 (docs/tads/vrm-mirror.md): back up every Avastar's
// VRM into operator-owned storage before the unmanaged IPFS copies
// disappear.
//
// For each token 0-26,616: metadata -> vrm_url (a missing one is a
// GAP, recorded, never an error) -> stream the bytes from the one
// live gateway (retry with backoff) -> verify (glTF magic + byte
// length against the gateway's declared length) -> sha256 while
// streaming -> `aws s3 cp` to the mirror -> delete the local temp.
// Stream-through on purpose: the corpus is ~280-295GB and must
// never accumulate locally.
//
// RESUMABLE: the manifest (Tools/data/vrm-manifest.json) is the
// durable record AND the resume state - a token with an entry or a
// gap is done; anything else is retried on the next run. The run
// is expected to span days and be interrupted freely.
//
// FOLLOWABLE: feedback/VRM-MIRROR.md carries a status block
// (rewritten as the run goes) plus an event log - `cat` it any
// time or `tail -f` it (TAD Decision 9).
//
// Needs the AWS CLI the operator already deploys with; no RPC.
//
// Usage:
//   node Tools/mirror-vrms.js                 capture (resumes)
//     [--dest s3://bucket/prefix/]            default s3://kwigbelle/vrm/
//     [--limit N]                             stop after N captures
//   node Tools/mirror-vrms.js --dry-run [N]   plan the first N
//                                             pending uploads, touch
//                                             nothing (default 5)
//   node Tools/mirror-vrms.js --verify [N]    re-download N random
//                                             mirrored files and
//                                             re-check sha256/size
//                                             (default 20)
//   node Tools/mirror-vrms.js --selftest      round-trip a local
//                                             fixture through the
//                                             stream-verify-hash
//                                             path; no network/S3
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { pipeline } = require("stream/promises");
const { Readable, Transform } = require("stream");

const TOKEN_COUNT = 26617;
const METADATA_URL = "https://avastars.io/metadata/";
// The one browser-reachable gateway left (TAD context, probed
// 2026-08-25). Path-style works for both bafy and Qm CIDs here.
const GATEWAY = "https://gateway.pinata.cloud/ipfs/";
const DEFAULT_DEST = "s3://kwigbelle/vrm/";
const DATA_DIR = path.join(__dirname, "data");
const MANIFEST_FILE = path.join(DATA_DIR, "vrm-manifest.json");
const TMP_FILE = path.join(DATA_DIR, "vrm-tmp.part");
const STATUS_FILE = path.join(__dirname, "..", "feedback", "VRM-MIRROR.md");
const TOKEN_DELAY_MS = 300; // be a polite gateway citizen
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 2000; // 2s, 4s, 8s... capped below
const RETRY_CAP_MS = 60000;
const ATTEMPT_TIMEOUT_MS = 240000; // whole-file cap per attempt
const METADATA_TIMEOUT_MS = 30000;
const FALLBACK_AVG_BYTES = 10700000; // sampled avg, for early ETAs

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const loadManifest = () => {
	try {
		return JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
	} catch (error) {
		return { entries: {}, gaps: {} };
	}
};

// Atomic write: a mid-write crash must never corrupt the resume
// state that days of capture depend on
const saveManifest = (manifest) => {
	const tmp = MANIFEST_FILE + ".tmp";
	fs.writeFileSync(tmp, JSON.stringify(manifest, null, 1));
	fs.renameSync(tmp, MANIFEST_FILE);
};

// ---- operator-facing status (TAD Decision 9) ----

// Events survive resumes: the tail of the existing file is carried
// forward and the header block is rewritten around it
const EVENTS_HEADING = "## Events";
const loadEvents = () => {
	try {
		const text = fs.readFileSync(STATUS_FILE, "utf8");
		const at = text.indexOf(EVENTS_HEADING);
		if (at < 0) {
			return [];
		}
		return text
			.slice(at + EVENTS_HEADING.length)
			.split("\n")
			.filter((line) => line.startsWith("- "));
	} catch (error) {
		return [];
	}
};

class Status {
	constructor(manifest) {
		this.events = loadEvents();
		this.runStart = Date.now();
		this.runBytes = 0;
		this.retriesThisRun = 0;
		this.failedThisRun = [];
		this.current = "-";
		this.manifest = manifest;
	}

	event(text) {
		this.events.push(`- ${new Date().toISOString()} ${text}`);
		this.write();
	}

	write() {
		const done = Object.keys(this.manifest.entries).length;
		const gaps = Object.keys(this.manifest.gaps).length;
		const remaining = TOKEN_COUNT - done - gaps;
		const totalBytes = Object.values(this.manifest.entries).reduce(
			(sum, entry) => sum + entry.size,
			0,
		);
		const avg = done > 0 ? totalBytes / done : FALLBACK_AVG_BYTES;
		const elapsed = (Date.now() - this.runStart) / 1000;
		const rate = elapsed > 1 ? this.runBytes / elapsed : 0;
		const etaHours = rate > 0 ? (remaining * avg) / rate / 3600 : null;
		const gb = (bytes) => (bytes / 1e9).toFixed(2);
		const lines = [
			"# VRM mirror status",
			"",
			`Updated: ${new Date().toISOString()}`,
			`Progress: ${done.toLocaleString()} / ${TOKEN_COUNT.toLocaleString()} captured (${((done / TOKEN_COUNT) * 100).toFixed(1)}%) · gaps: ${gaps} · pending: ${remaining}`,
			`Captured: ${gb(totalBytes)} GB total · ${gb(this.runBytes)} GB this run`,
			`Rate: ${(rate / 1e6).toFixed(2)} MB/s this run · ETA: ${etaHours === null ? "warming up" : "~" + etaHours.toFixed(1) + "h"}`,
			`Retries this run: ${this.retriesThisRun} · failed this run (will retry next run): ${this.failedThisRun.length ? this.failedThisRun.join(", ") : "none"}`,
			`Current: ${this.current}`,
			"",
			EVENTS_HEADING,
			...this.events,
			"",
		];
		fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
		fs.writeFileSync(STATUS_FILE, lines.join("\n"));
	}
}

// ---- fetch helpers ----

async function fetchMetadata(tokenId) {
	const res = await fetch(METADATA_URL + tokenId, {
		signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`metadata HTTP ${res.status} for ${tokenId}`);
	}
	return res.json();
}

// The vrm_url is canonical-ipfs.io shaped; the mirror pulls the
// same CID/path through the live gateway
const gatewayURL = (vrmURL) => {
	const at = vrmURL.indexOf("/ipfs/");
	if (at < 0) {
		throw new Error(`unrecognized vrm_url shape: ${vrmURL}`);
	}
	return GATEWAY + vrmURL.slice(at + "/ipfs/".length);
};

const cidOf = (vrmURL) => {
	const at = vrmURL.indexOf("/ipfs/");
	return vrmURL.slice(at + "/ipfs/".length).split("/")[0];
};

/// Stream a URL to filePath, hashing and verifying on the way.
/// Rejects on bad magic (every VRM is a glb: "glTF"), on a length
/// that disagrees with the gateway's declared content-length, and
/// on any transport error - the mirror only ever receives bytes
/// that already proved themselves.
async function downloadVerified(url, filePath) {
	const res = await fetch(url, {
		signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`HTTP ${res.status} via ${url}`);
	}
	const declared = Number(res.headers.get("content-length") || 0);
	const hash = crypto.createHash("sha256");
	let size = 0;
	let magic = null;
	const inspect = new Transform({
		transform(chunk, encoding, callback) {
			if (magic === null) {
				magic = chunk.subarray(0, 4).toString("latin1");
			}
			hash.update(chunk);
			size += chunk.length;
			callback(null, chunk);
		},
	});
	await pipeline(
		Readable.fromWeb(res.body),
		inspect,
		fs.createWriteStream(filePath),
	);
	if (magic !== "glTF") {
		throw new Error(`not a glb (magic ${JSON.stringify(magic)}) via ${url}`);
	}
	if (declared > 0 && size !== declared) {
		throw new Error(`truncated: ${size} of ${declared} bytes via ${url}`);
	}
	return { size, sha256: hash.digest("hex") };
}

const upload = (filePath, destURL) => {
	execFileSync(
		"aws",
		[
			"s3",
			"cp",
			filePath,
			destURL,
			"--content-type",
			"model/gltf-binary",
			// The corpus is frozen: mirrored objects never change
			"--cache-control",
			"public, max-age=31536000, immutable",
			"--only-show-errors",
		],
		{ stdio: "inherit" },
	);
};

// ---- modes ----

async function capture(dest, limit) {
	const manifest = loadManifest();
	const status = new Status(manifest);
	const done = Object.keys(manifest.entries).length;
	status.event(
		`run ${done > 0 ? "resumed" : "started"} at ${done.toLocaleString()} captured, dest ${dest}`,
	);
	let captured = 0;
	for (let tokenId = 0; tokenId < TOKEN_COUNT; tokenId++) {
		if (manifest.entries[tokenId] || manifest.gaps[tokenId] !== undefined) {
			continue;
		}
		if (limit && captured >= limit) {
			break;
		}
		let success = false;
		for (let attempt = 0; attempt <= MAX_RETRIES && !success; attempt++) {
			if (attempt > 0) {
				status.retriesThisRun++;
				await sleep(
					Math.min(RETRY_BASE_MS * Math.pow(2, attempt - 1), RETRY_CAP_MS),
				);
			}
			try {
				const metadata = await fetchMetadata(tokenId);
				if (!metadata.vrm_url) {
					manifest.gaps[tokenId] = "no vrm_url";
					saveManifest(manifest);
					status.event(`GAP: #${tokenId} has no vrm_url`);
					success = true;
					break;
				}
				const file = decodeURIComponent(metadata.vrm_url.split("/").pop());
				status.current = `#${tokenId} ${file} (attempt ${attempt + 1})`;
				status.write();
				const { size, sha256 } = await downloadVerified(
					gatewayURL(metadata.vrm_url),
					TMP_FILE,
				);
				upload(TMP_FILE, dest + file);
				fs.rmSync(TMP_FILE, { force: true });
				manifest.entries[tokenId] = {
					file,
					size,
					sha256,
					cid: cidOf(metadata.vrm_url),
				};
				saveManifest(manifest);
				status.runBytes += size;
				success = true;
			} catch (error) {
				fs.rmSync(TMP_FILE, { force: true });
				if (attempt === MAX_RETRIES) {
					status.failedThisRun.push(tokenId);
					status.event(
						`FAILED after ${MAX_RETRIES + 1} attempts: #${tokenId} (${error.message}) - will retry next run`,
					);
				}
			}
		}
		if (success && manifest.entries[tokenId]) {
			captured++;
			if (captured % 5 === 0) {
				status.write();
			}
		}
		await sleep(TOKEN_DELAY_MS);
	}
	status.current = "-";
	status.event(
		`run finished: ${captured.toLocaleString()} captured this run, ` +
			`${Object.keys(manifest.entries).length.toLocaleString()} total, ` +
			`${Object.keys(manifest.gaps).length} gaps, ` +
			`${status.failedThisRun.length} failures pending`,
	);
	console.log(`done - status in ${STATUS_FILE}`);
}

async function dryRun(count) {
	const manifest = loadManifest();
	const pending = [];
	for (let tokenId = 0; tokenId < TOKEN_COUNT; tokenId++) {
		if (!manifest.entries[tokenId] && manifest.gaps[tokenId] === undefined) {
			pending.push(tokenId);
		}
		if (pending.length >= count) {
			break;
		}
	}
	console.log(`planning the first ${pending.length} pending uploads:`);
	for (const tokenId of pending) {
		const metadata = await fetchMetadata(tokenId);
		if (!metadata.vrm_url) {
			console.log(`  #${tokenId}: GAP (no vrm_url)`);
			continue;
		}
		const file = decodeURIComponent(metadata.vrm_url.split("/").pop());
		console.log(
			`  #${tokenId}: ${gatewayURL(metadata.vrm_url)}\n` +
				`      -> ${argDest()}${file}`,
		);
	}
	console.log("dry run: nothing downloaded, nothing uploaded");
}

async function verify(sampleSize) {
	const manifest = loadManifest();
	const tokenIds = Object.keys(manifest.entries);
	if (tokenIds.length === 0) {
		console.error("nothing mirrored yet - run the capture first");
		process.exit(1);
	}
	const sample = [];
	while (sample.length < Math.min(sampleSize, tokenIds.length)) {
		const pick = tokenIds[Math.floor(Math.random() * tokenIds.length)];
		if (!sample.includes(pick)) {
			sample.push(pick);
		}
	}
	let bad = 0;
	for (const tokenId of sample) {
		const entry = manifest.entries[tokenId];
		execFileSync(
			"aws",
			["s3", "cp", argDest() + entry.file, TMP_FILE, "--only-show-errors"],
			{ stdio: "inherit" },
		);
		const bytes = fs.readFileSync(TMP_FILE);
		const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
		const ok = bytes.length === entry.size && sha256 === entry.sha256;
		console.log(
			`#${tokenId} ${entry.file}: ${ok ? "OK" : `MISMATCH (${bytes.length} bytes, ${sha256})`}`,
		);
		if (!ok) {
			bad++;
		}
		fs.rmSync(TMP_FILE, { force: true });
	}
	console.log(
		`${sample.length - bad}/${sample.length} verified against the manifest`,
	);
	process.exit(bad === 0 ? 0 : 1);
}

// The stream-verify-hash path against a local fixture: a good glb
// passes with the right size+sha, a bad magic is rejected, and a
// truncated body (content-length disagreement) is rejected.
async function selftest() {
	const good = Buffer.concat([Buffer.from("glTF"), crypto.randomBytes(100000)]);
	const expectedSha = crypto.createHash("sha256").update(good).digest("hex");
	const server = http.createServer((request, response) => {
		if (request.url === "/good.vrm") {
			response.writeHead(200, { "Content-Length": String(good.length) });
			response.end(good);
		} else if (request.url === "/badmagic.vrm") {
			const bad = Buffer.concat([Buffer.from("NOPE"), good.subarray(4)]);
			response.writeHead(200, { "Content-Length": String(bad.length) });
			response.end(bad);
		} else {
			// Truncated: promises more bytes than it sends
			response.writeHead(200, { "Content-Length": String(good.length * 2) });
			response.end(good);
		}
	});
	await new Promise((resolve) => server.listen(0, resolve));
	const base = `http://localhost:${server.address().port}`;
	const fail = (message) => {
		console.error("SELFTEST FAIL:", message);
		process.exit(1);
	};
	const result = await downloadVerified(`${base}/good.vrm`, TMP_FILE);
	if (result.size !== good.length || result.sha256 !== expectedSha) {
		fail("good fixture round-trip mismatched size/sha");
	}
	if (!fs.readFileSync(TMP_FILE).equals(good)) {
		fail("good fixture bytes corrupted on disk");
	}
	await downloadVerified(`${base}/badmagic.vrm`, TMP_FILE).then(
		() => fail("bad magic was accepted"),
		() => {},
	);
	await downloadVerified(`${base}/truncated.vrm`, TMP_FILE).then(
		() => fail("truncated body was accepted"),
		() => {},
	);
	fs.rmSync(TMP_FILE, { force: true });
	server.close();
	console.log(
		"SELFTEST PASS: verified round-trip, bad-magic and truncation rejection",
	);
}

// ---- entry ----

const argv = process.argv.slice(2);
const argValue = (flag, fallback) => {
	const at = argv.indexOf(flag);
	if (at < 0) {
		return null;
	}
	const next = Number(argv[at + 1]);
	return Number.isFinite(next) ? next : fallback;
};
function argDest() {
	const at = argv.indexOf("--dest");
	let dest = at >= 0 ? argv[at + 1] : DEFAULT_DEST;
	if (!dest || !dest.startsWith("s3://")) {
		console.error("--dest must be an s3://bucket/prefix/ URL");
		process.exit(1);
	}
	if (!dest.endsWith("/")) {
		dest += "/";
	}
	return dest;
}

(async () => {
	fs.mkdirSync(DATA_DIR, { recursive: true });
	if (argv.includes("--selftest")) {
		await selftest();
	} else if (argv.includes("--dry-run")) {
		await dryRun(argValue("--dry-run", 5) || 5);
	} else if (argv.includes("--verify")) {
		await verify(argValue("--verify", 20) || 20);
	} else {
		await capture(argDest(), argValue("--limit", 0));
	}
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
