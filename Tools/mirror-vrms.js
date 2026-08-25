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
//     [--limit N]                             stop once N captures
//                                             land (workers may add
//                                             a few in-flight extras)
//     [--parallel N]                          tokens in flight, 1-4
//                                             (default 3)
//     [--gateway <url>/ipfs/]                 fetch through another
//                                             gateway - e.g. a local
//                                             kubo node's
//                                             http://127.0.0.1:8080/ipfs/
//                                             (bitswap, no HTTP rate
//                                             limits)
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
const { execFileSync, spawn } = require("child_process");
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
const IDLE_TIMEOUT_MS = 60000; // abort only when bytes STOP flowing
const METADATA_TIMEOUT_MS = 30000;
const FALLBACK_AVG_BYTES = 10700000; // sampled avg, for early ETAs

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Exactly one capture at a time: two runs would interleave their
// manifest snapshots and silently lose each other's records. The
// lock names the owning pid; a dead owner's lock is stale and
// reclaimed.
const LOCK_FILE = path.join(DATA_DIR, "vrm-mirror.lock");
const isAlive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return false;
	}
};
const refuseLock = (pid) => {
	console.error(
		`another capture (pid ${pid}) is already running - stop it ` +
			"first; two concurrent runs would corrupt the manifest",
	);
	process.exit(1);
};
const acquireLock = () => {
	// Atomic create ("wx") closes the read-check-write race two
	// simultaneous starts would otherwise slip through (review
	// catch). A dead owner's lock is reclaimed by an atomic RENAME
	// steal - exactly one contender can win the rename; the loser
	// loops and meets the winner's live lock instead. Deeper
	// (3-way) interleavings can still strand a live process without
	// its lock file, so the CAPTURE LOOP re-verifies ownership
	// before every token and aborts if the lock changed hands -
	// that backstop, not this dance, is the corruption guarantee
	// (review catch).
	let acquired = false;
	for (let attempt = 0; attempt < 3 && !acquired; attempt++) {
		try {
			fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
			acquired = true;
			break;
		} catch (error) {
			if (error.code !== "EEXIST") {
				throw error;
			}
		}
		let pid = 0;
		try {
			pid = Number(fs.readFileSync(LOCK_FILE, "utf8"));
		} catch (readError) {
			// Vanished between the create attempt and here: loop
			continue;
		}
		if (pid && isAlive(pid)) {
			refuseLock(pid);
		}
		const stolen = `${LOCK_FILE}.reclaim-${process.pid}`;
		try {
			fs.renameSync(LOCK_FILE, stolen);
		} catch (error) {
			// Lost the steal race: loop and re-judge the fresh lock
			continue;
		}
		// Confirm the steal took the dead lock we judged - if it
		// changed hands to a LIVE owner mid-steal, hand it back
		let stolenPid = 0;
		try {
			stolenPid = Number(fs.readFileSync(stolen, "utf8"));
		} catch (readError) {
			// Unreadable spoils: discard below and retry
		}
		if (stolenPid && stolenPid !== pid && isAlive(stolenPid)) {
			// The steal caught a lock that changed hands to a LIVE
			// owner mid-dance. Hand it back by EXCLUSIVE create only -
			// a rename here could atomically overwrite a THIRD
			// contender's fresh lock (review catch). If someone else
			// claimed the name meanwhile, their lock stands untouched
			// and the displaced owner's per-token ownership check
			// stops that run safely.
			try {
				fs.writeFileSync(LOCK_FILE, String(stolenPid), { flag: "wx" });
			} catch (error) {
				// A fresh lock exists: leave it standing
			}
			fs.rmSync(stolen, { force: true });
			refuseLock(stolenPid);
		}
		fs.rmSync(stolen, { force: true });
		// Loop: retry the atomic create
	}
	if (!acquired) {
		console.error(
			"could not acquire the capture lock - another capture is " +
				"starting at the same time; try again in a moment",
		);
		process.exit(1);
	}
	process.on("exit", () => {
		try {
			// Only remove a lock this process still owns
			if (Number(fs.readFileSync(LOCK_FILE, "utf8")) === process.pid) {
				fs.rmSync(LOCK_FILE, { force: true });
			}
		} catch (error) {
			// Best-effort cleanup; a stale lock is reclaimed anyway
		}
	});
	// Signal-killed runs must still run the exit handler above, or
	// the next start pays a confusing (if reclaimable) stale lock
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.on(signal, () => process.exit(130));
	}
};

const loadManifest = () => {
	let text;
	try {
		text = fs.readFileSync(MANIFEST_FILE, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") {
			return { entries: {}, gaps: {} };
		}
		throw error;
	}
	// A manifest that EXISTS but won't parse must fail the run, not
	// silently reset the resume state - the next save would
	// overwrite days of capture records (review catch)
	try {
		return JSON.parse(text);
	} catch (error) {
		console.error(
			`${MANIFEST_FILE} exists but will not parse (${error.message}).\n` +
				"Refusing to reset the resume state - recover the file or " +
				"move it aside deliberately first.",
		);
		process.exit(1);
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
		// workerId -> "#token file (attempt n)" for every in-flight
		// capture (workers run in parallel)
		this.inFlight = new Map();
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
			`In flight: ${[...this.inFlight.values()].join(" · ") || "-"}`,
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

// Global gateway cooldown, shared by EVERY worker: HTTP 429 means
// the gateway wants the whole client slowed, so per-attempt
// backoff alone just moves the hammering between workers (field
// data 2026-08-25: sustained 429s at --parallel 2). All gateway
// requests wait out the window; a 429 extends it by the response's
// Retry-After (default 60s).
const cooldown = { until: 0, notify: null };
const waitCooldown = async () => {
	while (Date.now() < cooldown.until) {
		await sleep(Math.min(cooldown.until - Date.now() + 50, 5000));
	}
};
const startCooldown = (seconds, url) => {
	const until = Date.now() + seconds * 1000;
	if (until > cooldown.until) {
		cooldown.until = until;
		if (cooldown.notify) {
			cooldown.notify(
				`gateway 429 - all workers cooling down ${seconds}s (${url})`,
			);
		}
	}
};

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
// same CID/path through the capture gateway. --gateway overrides
// the default - e.g. a LOCAL kubo node's gateway
// (http://127.0.0.1:8080/ipfs/) fetches over bitswap with no HTTP
// rate limit at all (operator escape hatch, 2026-08-25).
let gatewayBase = GATEWAY;
const gatewayURL = (vrmURL) => {
	const at = vrmURL.indexOf("/ipfs/");
	if (at < 0) {
		throw new Error(`unrecognized vrm_url shape: ${vrmURL}`);
	}
	return gatewayBase + vrmURL.slice(at + "/ipfs/".length);
};

const cidOf = (vrmURL) => {
	const at = vrmURL.indexOf("/ipfs/");
	return vrmURL.slice(at + "/ipfs/".length).split("/")[0];
};

/// Stream a URL to filePath, hashing and verifying on the way.
/// Rejects on bad magic (every VRM is a glb: "glTF"), on a length
/// that disagrees with the gateway's declared content-length, and
/// on any transport error - the mirror only ever receives bytes
/// that already proved themselves. The abort is INACTIVITY-based
/// (review catch): a big file on a slow link must be allowed to
/// finish as long as bytes keep flowing.
async function downloadVerified(url, filePath) {
	await waitCooldown();
	const controller = new AbortController();
	let idleTimer = null;
	const armIdle = () => {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
	};
	armIdle();
	try {
		const res = await fetch(url, { signal: controller.signal });
		if (res.status === 429) {
			// Undrained bodies hold their pooled connection in undici -
			// cancel before throwing (review catch), on both paths
			res.body?.cancel();
			// Retry-After is delta-seconds OR an HTTP-date (review
			// catch); clamped so a bogus header can't wedge the pool
			// for hours (review catch)
			const header = res.headers.get("retry-after");
			let retryAfter = Number(header);
			if (!Number.isFinite(retryAfter) && header) {
				retryAfter = (Date.parse(header) - Date.now()) / 1000;
			}
			startCooldown(
				Number.isFinite(retryAfter) && retryAfter > 0
					? Math.min(retryAfter, 300)
					: 60,
				url,
			);
			throw new Error(`HTTP 429 via ${url}`);
		}
		if (!res.ok) {
			res.body?.cancel();
			throw new Error(`HTTP ${res.status} via ${url}`);
		}
		// Node's fetch decompresses encoded bodies but the header
		// reflects the COMPRESSED size: only enforce the length for
		// identity-coded responses (review catch)
		const bodyEncoding = res.headers.get("content-encoding");
		const declared =
			!bodyEncoding || bodyEncoding === "identity"
				? Number(res.headers.get("content-length") || 0)
				: 0;
		const hash = crypto.createHash("sha256");
		let size = 0;
		// Streams may deliver arbitrarily small chunks: accumulate
		// the first four bytes before judging the magic (review
		// catch)
		let head = Buffer.alloc(0);
		const inspect = new Transform({
			transform(chunk, encoding, callback) {
				armIdle();
				if (head.length < 4) {
					head = Buffer.concat([head, chunk]).subarray(0, 4);
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
		const magic = head.toString("latin1");
		if (magic !== "glTF") {
			throw new Error(`not a glb (magic ${JSON.stringify(magic)}) via ${url}`);
		}
		if (declared > 0 && size !== declared) {
			throw new Error(`truncated: ${size} of ${declared} bytes via ${url}`);
		}
		return { size, sha256: hash.digest("hex") };
	} finally {
		clearTimeout(idleTimer);
	}
}

// The mirror key comes from remote metadata: only a plain
// single-segment *.vrm name may pass, or a crafted filename could
// land OUTSIDE vrm/ - beyond the deploy guardrail's protection
// (review catch). Deterministic, so failures are never retried.
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.vrm$/;

// Async on purpose (review catch): a synchronous exec would freeze
// the event loop for the whole upload, stalling every sibling
// worker's in-flight download - the exact latency-hiding the pool
// exists for
const upload = (filePath, destURL) =>
	new Promise((resolve, reject) => {
		const child = spawn(
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
			{ stdio: ["ignore", "inherit", "inherit"] },
		);
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`aws s3 cp exited ${code}`));
			}
		});
	});

// ---- modes ----

async function capture(dest, limit, parallel) {
	acquireLock();
	const manifest = loadManifest();
	// One mirror, one destination: a dest that disagrees with the
	// manifest's would silently split the backup (review catch)
	if (manifest.dest && manifest.dest !== dest) {
		console.error(
			`This manifest was captured to ${manifest.dest}; refusing to ` +
				`continue to ${dest}. Pass --dest ${manifest.dest}, or move ` +
				"the manifest aside to start a separate mirror.",
		);
		process.exit(1);
	}
	manifest.dest = dest;
	const status = new Status(manifest);
	// 429 cooldowns land in the event log so throttling is visible
	cooldown.notify = (text) => status.event(text);
	const done = Object.keys(manifest.entries).length;
	status.event(
		`run ${done > 0 ? "resumed" : "started"} at ${done.toLocaleString()} captured, dest ${dest}, ${parallel} in flight`,
	);
	// A killed run can strand WORKER temp files (numeric suffixes
	// only - a concurrent --verify/--selftest owns .verify and
	// .selftest, and sweeping those would break the very audits
	// their dedicated names exist for; review catch)
	const workerTemp = new RegExp(
		`^${path.basename(TMP_FILE).replace(/\./g, "\\.")}\\.\\d+$`,
	);
	// A crashed reclaim can also strand a .reclaim-* lock temp
	// (review catch); a live contender's copy lives microseconds
	// and its deletion is harmless
	const reclaimTemp = `${path.basename(LOCK_FILE)}.reclaim-`;
	for (const stale of fs.readdirSync(DATA_DIR)) {
		if (workerTemp.test(stale) || stale.startsWith(reclaimTemp)) {
			fs.rmSync(path.join(DATA_DIR, stale), { force: true });
		}
	}
	// The corruption BACKSTOP for every exotic lock interleaving:
	// a worker only proceeds while this process still owns the
	// lock file. A displaced run aborts before it can interleave
	// manifest snapshots with the new owner (review catch).
	const assertLockOwned = () => {
		let owner = 0;
		try {
			owner = Number(fs.readFileSync(LOCK_FILE, "utf8"));
		} catch (error) {
			// A missing lock counts as lost
		}
		if (owner !== process.pid) {
			status.event(
				"run ABORTED: capture lock lost to another process - " +
					"re-run when no other capture is active",
			);
			console.error("aborting: capture lock lost - see " + STATUS_FILE);
			process.exit(1);
		}
	};
	// Filename uniqueness across tokens: a duplicate key would
	// silently overwrite another token's mirror object (review
	// catch). mirroredFiles = completed captures; inFlightFiles
	// reserves names claimed by concurrent workers.
	const mirroredFiles = new Set(
		Object.values(manifest.entries).map((entry) => entry.file),
	);
	const inFlightFiles = new Map();
	// Tokens failing back-to-back at the UPLOAD step smell like an
	// AWS auth/config problem: abort loudly instead of burning the
	// retry budget across 26k tokens (review catch). Approximate
	// under parallelism - any success resets it.
	let uploadFailStreak = 0;
	let captured = 0;
	let nextTokenId = 0;
	const claimNext = () => {
		// Limit counts CAPTURES, not attempts (review catch - the
		// documented "stop after N captures"); with workers in
		// flight the run may land a few extras past N
		if (limit && captured >= limit) {
			return undefined;
		}
		while (nextTokenId < TOKEN_COUNT) {
			const tokenId = nextTokenId++;
			if (manifest.entries[tokenId] || manifest.gaps[tokenId] !== undefined) {
				continue;
			}
			return tokenId;
		}
		return undefined;
	};
	const captureToken = async (tokenId, workerId, tmpFile) => {
		let success = false;
		let lastError = null;
		let reserved = null;
		for (let attempt = 0; attempt <= MAX_RETRIES && !success; attempt++) {
			if (attempt > 0) {
				status.retriesThisRun++;
				await sleep(
					Math.min(RETRY_BASE_MS * Math.pow(2, attempt - 1), RETRY_CAP_MS),
				);
			}
			// A retry may resolve a DIFFERENT filename: release the
			// previous reservation or it leaks for the whole run
			// (review catch)
			if (reserved !== null && inFlightFiles.get(reserved) === tokenId) {
				inFlightFiles.delete(reserved);
				reserved = null;
			}
			try {
				const metadata = await fetchMetadata(tokenId);
				if (!metadata.vrm_url) {
					// Ownership re-checked at the WRITE, not just the claim:
					// a lock lost during the fetch must not let this save
					// overwrite a newer owner's snapshot (review catch)
					assertLockOwned();
					manifest.gaps[tokenId] = "no vrm_url";
					saveManifest(manifest);
					status.event(`GAP: #${tokenId} has no vrm_url`);
					success = true;
					break;
				}
				const file = decodeURIComponent(metadata.vrm_url.split("/").pop());
				if (!SAFE_FILE.test(file)) {
					// Deterministic: retrying can't fix a bad name
					status.failedThisRun.push(tokenId);
					status.event(
						`FAILED (no retry): #${tokenId} unsafe filename ` +
							`${JSON.stringify(file)} in metadata - investigate upstream`,
					);
					break;
				}
				const inFlightOwner = inFlightFiles.get(file);
				if (
					mirroredFiles.has(file) ||
					(inFlightOwner !== undefined && inFlightOwner !== tokenId)
				) {
					const owner =
						inFlightOwner !== undefined && inFlightOwner !== tokenId
							? inFlightOwner
							: Object.keys(manifest.entries).find(
									(id) => manifest.entries[id].file === file,
								);
					status.failedThisRun.push(tokenId);
					status.event(
						`FAILED (no retry): #${tokenId} filename ${file} collides ` +
							`with #${owner} - uploading would overwrite its object`,
					);
					break;
				}
				inFlightFiles.set(file, tokenId);
				reserved = file;
				status.inFlight.set(
					workerId,
					`#${tokenId} ${file} (attempt ${attempt + 1})`,
				);
				status.write();
				const { size, sha256 } = await downloadVerified(
					gatewayURL(metadata.vrm_url),
					tmpFile,
				);
				try {
					await upload(tmpFile, dest + file);
				} catch (error) {
					throw new Error(`upload: ${error.message}`);
				}
				fs.rmSync(tmpFile, { force: true });
				// Same write-time ownership gate as the gap path: a lock
				// lost during the long download/upload aborts here,
				// before this save can clobber the new owner's manifest
				assertLockOwned();
				manifest.entries[tokenId] = {
					file,
					size,
					sha256,
					cid: cidOf(metadata.vrm_url),
				};
				saveManifest(manifest);
				mirroredFiles.add(file);
				status.runBytes += size;
				uploadFailStreak = 0;
				success = true;
			} catch (error) {
				fs.rmSync(tmpFile, { force: true });
				lastError = error;
				if (attempt === MAX_RETRIES) {
					status.failedThisRun.push(tokenId);
					status.event(
						`FAILED after ${MAX_RETRIES + 1} attempts: #${tokenId} (${error.message}) - will retry next run`,
					);
				}
			}
		}
		if (reserved !== null && inFlightFiles.get(reserved) === tokenId) {
			inFlightFiles.delete(reserved);
		}
		if (!success && lastError && lastError.message.startsWith("upload:")) {
			uploadFailStreak++;
			if (uploadFailStreak >= 3) {
				status.event(
					"run ABORTED: three back-to-back tokens failed at the " +
						"upload step - check AWS credentials/permissions and re-run",
				);
				console.error(
					"aborting: three back-to-back upload failures - see " + STATUS_FILE,
				);
				process.exit(1);
			}
		}
		if (success && manifest.entries[tokenId]) {
			captured++;
			if (captured % 5 === 0) {
				status.write();
			}
		}
	};
	// The worker pool: N tokens in flight (operator directive - the
	// sequential run's wall-clock was dominated by gateway latency
	// and retry backoff, which parallelism hides; it cannot beat
	// the uplink's actual bandwidth). Node is single-threaded, so
	// the shared manifest/status mutations between awaits are safe.
	const worker = async (workerId) => {
		const tmpFile = `${TMP_FILE}.${workerId}`;
		for (;;) {
			assertLockOwned();
			const tokenId = claimNext();
			if (tokenId === undefined) {
				status.inFlight.delete(workerId);
				return;
			}
			await captureToken(tokenId, workerId, tmpFile);
			await sleep(TOKEN_DELAY_MS);
		}
	};
	await Promise.all(
		Array.from({ length: parallel }, (unused, index) => worker(index)),
	);
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
	const dest = manifest.dest || argDest();
	for (const tokenId of pending) {
		// One failing token must not kill the whole plan (review
		// catch - capture retries, the plan just reports)
		try {
			const metadata = await fetchMetadata(tokenId);
			if (!metadata.vrm_url) {
				console.log(`  #${tokenId}: GAP (no vrm_url)`);
				continue;
			}
			const file = decodeURIComponent(metadata.vrm_url.split("/").pop());
			const safe = SAFE_FILE.test(file) ? "" : "  [UNSAFE NAME - would skip]";
			console.log(
				`  #${tokenId}: ${gatewayURL(metadata.vrm_url)}\n` +
					`      -> ${dest}${file}${safe}`,
			);
		} catch (error) {
			console.log(`  #${tokenId}: plan failed (${error.message})`);
		}
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
	// Audit the destination the manifest was CAPTURED to - a stale
	// --dest default must not silently verify the wrong bucket
	// (review catch)
	const dest = manifest.dest || argDest();
	// Own temp name: safe to audit while a capture is running
	const tmpFile = `${TMP_FILE}.verify`;
	let bad = 0;
	for (const tokenId of sample) {
		const entry = manifest.entries[tokenId];
		// One failing download must not kill the audit: report it
		// and keep sampling (review catch)
		try {
			execFileSync(
				"aws",
				["s3", "cp", dest + entry.file, tmpFile, "--only-show-errors"],
				{ stdio: "inherit" },
			);
			const bytes = fs.readFileSync(tmpFile);
			const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
			const ok = bytes.length === entry.size && sha256 === entry.sha256;
			console.log(
				`#${tokenId} ${entry.file}: ${ok ? "OK" : `MISMATCH (${bytes.length} bytes, ${sha256})`}`,
			);
			if (!ok) {
				bad++;
			}
		} catch (error) {
			console.log(`#${tokenId} ${entry.file}: FETCH FAILED (${error.message})`);
			bad++;
		}
		fs.rmSync(tmpFile, { force: true });
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
	// Own temp name: a concurrently running capture must not clobber
	// (or be clobbered by) the fixture round-trip
	const tmpFile = `${TMP_FILE}.selftest`;
	const good = Buffer.concat([Buffer.from("glTF"), crypto.randomBytes(100000)]);
	const expectedSha = crypto.createHash("sha256").update(good).digest("hex");
	let throttled = false;
	const server = http.createServer((request, response) => {
		if (request.url === "/good.vrm") {
			response.writeHead(200, { "Content-Length": String(good.length) });
			response.end(good);
		} else if (request.url === "/throttle.vrm") {
			// First hit rate-limits with a 1s Retry-After; the retry
			// after the cooldown serves normally
			if (!throttled) {
				throttled = true;
				response.writeHead(429, { "Retry-After": "1" });
				response.end("slow down");
			} else {
				response.writeHead(200, { "Content-Length": String(good.length) });
				response.end(good);
			}
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
	const result = await downloadVerified(`${base}/good.vrm`, tmpFile);
	if (result.size !== good.length || result.sha256 !== expectedSha) {
		fail("good fixture round-trip mismatched size/sha");
	}
	if (!fs.readFileSync(tmpFile).equals(good)) {
		fail("good fixture bytes corrupted on disk");
	}
	// Assert the rejection KIND: a generic transport failure here
	// would otherwise pass as a false negative (review catch)
	await downloadVerified(`${base}/badmagic.vrm`, tmpFile).then(
		() => fail("bad magic was accepted"),
		(error) => {
			if (!error.message.includes("not a glb")) {
				fail("bad-magic case rejected for the wrong reason: " + error.message);
			}
		},
	);
	await downloadVerified(`${base}/truncated.vrm`, tmpFile).then(
		() => fail("truncated body was accepted"),
		(error) => {
			// Node's fetch (undici) enforces content-length itself and
			// rejects short bodies as "terminated" before the tool's own
			// length check; the in-tool check remains for responses the
			// transport can't police. Either rejection kind counts.
			if (
				!error.message.includes("truncated") &&
				!error.message.includes("terminated")
			) {
				fail("truncation case rejected for the wrong reason: " + error.message);
			}
		},
	);
	// 429 handling: the first hit rejects AND arms the shared
	// cooldown (Retry-After honored); the retry waits it out and
	// succeeds
	await downloadVerified(`${base}/throttle.vrm`, tmpFile).then(
		() => fail("429 was accepted as success"),
		(error) => {
			if (!error.message.includes("HTTP 429")) {
				fail("throttle case rejected for the wrong reason: " + error.message);
			}
		},
	);
	if (cooldown.until <= Date.now()) {
		fail("429 did not arm the shared cooldown");
	}
	const throttleStart = Date.now();
	const retried = await downloadVerified(`${base}/throttle.vrm`, tmpFile);
	if (retried.sha256 !== expectedSha) {
		fail("post-cooldown retry returned wrong bytes");
	}
	if (Date.now() - throttleStart < 900) {
		fail("retry did not wait out the Retry-After cooldown");
	}
	fs.rmSync(tmpFile, { force: true });
	server.close();
	console.log(
		"SELFTEST PASS: verified round-trip, bad-magic/truncation rejection, " +
			"429 cooldown honored",
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
	// Parsed ahead of the mode dispatch so --dry-run previews the
	// SAME gateway a capture would use (review catch)
	const gatewayAt = argv.indexOf("--gateway");
	if (gatewayAt >= 0) {
		const override = argv[gatewayAt + 1];
		if (!override || !/^https?:\/\/.+\/ipfs\/$/.test(override)) {
			console.error('--gateway must be an http(s) URL ending in "/ipfs/"');
			process.exit(1);
		}
		gatewayBase = override;
	}
	if (argv.includes("--selftest")) {
		await selftest();
	} else if (argv.includes("--dry-run")) {
		await dryRun(argValue("--dry-run", 5) || 5);
	} else if (argv.includes("--verify")) {
		await verify(argValue("--verify", 20) || 20);
	} else {
		// 1-4 workers: enough to hide gateway latency and retry
		// backoff, few enough to stay a polite gateway citizen
		const parallel = Math.max(1, Math.min(4, argValue("--parallel", 3) || 3));
		await capture(argDest(), argValue("--limit", 0), parallel);
	}
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
