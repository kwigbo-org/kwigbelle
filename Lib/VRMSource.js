import { kindLabel } from "./RarityIcons.js";

/// The operator-owned mirror prefix (docs/tads/vrm-mirror.md
/// Decision 1). ABSOLUTE on purpose: the one mirror is addressed
/// identically from prod, stage, and local dev (CORS ops landed
/// 2026-08-27), so serving, the backup indicator, and the status
/// modal all read the same place.
export const MIRROR_BASE = "https://kwigbelle.com/vrm/";

// CIDv0 -> CIDv1 conversion: founder and replicant models are
// published under Qm... (CIDv0, base58) CIDs, whose mixed case
// breaks the subdomain redirect several public gateways answer
// with - the fetch dies on CORS/DNS instead of serving. The same
// content addressed as CIDv1 base32 survives every redirect style
// (verified live: pinata serves both forms byte-identically).
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function base58Decode(text) {
	let value = 0n;
	for (const char of text) {
		const digit = BASE58.indexOf(char);
		if (digit < 0) {
			throw new Error(`invalid base58 character ${char}`);
		}
		value = value * 58n + BigInt(digit);
	}
	const bytes = [];
	while (value > 0n) {
		bytes.unshift(Number(value & 0xffn));
		value >>= 8n;
	}
	for (const char of text) {
		if (char !== "1") {
			break;
		}
		bytes.unshift(0);
	}
	return bytes;
}

function base32Encode(bytes) {
	let out = "";
	let bits = 0;
	let value = 0;
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += BASE32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) {
		out += BASE32[(value << (5 - bits)) & 31];
	}
	return out;
}

/// - Parameter cid: A CIDv0 (Qm..., base58 sha2-256 multihash)
/// - Returns: The equivalent CIDv1 as lowercase base32 (dag-pb)
export function cidV0toV1(cid) {
	const multihash = base58Decode(cid);
	if (
		multihash.length !== 34 ||
		multihash[0] !== 0x12 ||
		multihash[1] !== 0x20
	) {
		throw new Error("not a sha2-256 CIDv0");
	}
	// version 1 + dag-pb codec + the multihash, multibase 'b'
	return "b" + base32Encode([0x01, 0x70, ...multihash]);
}

/// Where a token's 3D model comes from: the operator-owned MIRROR
/// first (docs/tads/vrm-mirror.md - filename derived from the hash
/// corpus, so the happy path makes no avastars.io call and
/// outlives it), falling back to the original pipeline
/// (docs/tads/vrm-viewer.md: metadata -> vrm_url -> hedged IPFS
/// gateway race). Progress reporting and a small in-memory cache
/// (~9.3MB per model, so nothing is fetched until asked).
export default class VRMSource {
	constructor() {
		this.metadataURL = "https://avastars.io/metadata/";
		// The mirror (docs/tads/vrm-mirror.md Decision 5): every
		// model backed up under one absolute prefix behind the
		// site's CloudFront. Absolute on purpose - ONE copy,
		// addressable from prod, stage, and local dev alike.
		this.mirrorBase = MIRROR_BASE;
		// The scene wires this to the hash corpus:
		// (tokenId) -> Promise<"prime"|"replicant"|null>. Without it
		// the mirror lane stays off and behavior is unchanged.
		this.kindFor = null;
		// First-byte cap on the single mirror attempt - a hung CDN
		// must fall back to the gateway race, not wedge the view
		this.mirrorFirstByteMs = 8000;
		// Observed-reliable gateway first: on the discovery probe
		// gateway.pinata.cloud served content the canonical ipfs.io
		// URL 504'd on, and a 504 only arrives after the gateway's
		// own long timeout - order is the difference between ~2s
		// and ~60s to first paint on cold content.
		this.gateways = [
			"https://gateway.pinata.cloud/ipfs/",
			"https://ipfs.io/ipfs/",
			"https://dweb.link/ipfs/",
		];
		this.infoCache = new Map();
		this.bytesCache = new Map();
		this.bytesCacheLimit = 3;
		// Hedged-race tuning (see hedgedDownload): how long a
		// gateway may sit silent before the next one also starts,
		// and the hard cap on any attempt reaching its first byte
		this.staggerMs = 4000;
		this.firstByteMs = 20000;
		// Pause before the one automatic re-race after a full
		// failure (see fetchVRM)
		this.retryDelayMs = 1500;
	}

	/// The mirror URL for a token, or null when the kind lookup is
	/// absent or doesn't know the token. Filenames are derivable
	/// facts: `Avastar_{Kind}_{id}.vrm`, exactly the vocabulary
	/// kindLabel computes from the hash corpus - verified against
	/// live vrm_url basenames across all four kinds (TAD context).
	///
	/// - Parameter tokenId: The token to address
	async mirrorURL(tokenId) {
		if (!this.kindFor) {
			return null;
		}
		let kind = null;
		try {
			kind = await this.kindFor(tokenId);
		} catch (error) {
			return null;
		}
		if (!kind) {
			return null;
		}
		const id = encodeURIComponent(String(tokenId));
		return `${this.mirrorBase}Avastar_${kindLabel(tokenId, kind)}_${id}.vrm`;
	}

	/// The model URL and original filename for a token, from the
	/// metadata endpoint (cached per token; the endpoint echoes the
	/// requesting origin, so the browser can call it directly).
	/// When the metadata endpoint is unreachable but the mirror can
	/// derive the filename, a degraded info (url: null - no gateway
	/// source) is returned UNCACHED so downloads keep their proper
	/// filename even if avastars.io is gone.
	///
	/// - Parameters:
	///		- tokenId: The token to look up
	///		- signal: Optional AbortSignal - a cancel must cover the
	///			metadata phase too, not just the byte download
	async vrmInfo(tokenId, signal) {
		const key = String(tokenId);
		if (this.infoCache.has(key)) {
			return this.infoCache.get(key);
		}
		let metadata;
		try {
			const response = await fetch(this.metadataURL + key, { signal });
			if (!response.ok) {
				throw new Error(`metadata request failed (HTTP ${response.status})`);
			}
			metadata = await response.json();
			if (!metadata || !metadata.vrm_url) {
				throw new Error("metadata has no vrm_url");
			}
		} catch (error) {
			if (error && error.name === "AbortError") {
				throw error;
			}
			const mirror = await this.mirrorURL(tokenId);
			if (!mirror) {
				throw error;
			}
			return { url: null, filename: mirror.split("/").pop() };
		}
		const info = {
			url: metadata.vrm_url,
			filename: metadata.vrm_url.split("/").pop() || `Avastar_${key}.vrm`,
		};
		this.infoCache.set(key, info);
		return info;
	}

	/// Candidate URLs for a model: the /ipfs/{cid}/{path} suffix
	/// re-anchored on each gateway in order, or the URL as given
	/// when it doesn't have the /ipfs/ shape (no fallback then -
	/// fetched as published rather than rejected). Qm CIDs are
	/// rewritten to CIDv1 so subdomain-redirecting gateways can
	/// serve founder/replicant models (see cidV0toV1).
	///
	/// - Parameter url: The published vrm_url
	candidateURLs(url) {
		const match = url.match(/\/ipfs\/([^/]+)(\/.*)?$/);
		if (!match) {
			return [url];
		}
		let cid = match[1];
		const rest = match[2] || "";
		if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid)) {
			try {
				cid = cidV0toV1(cid);
			} catch {
				// Unconvertible: keep the published form
			}
		}
		return this.gateways.map((gateway) => gateway + cid + rest);
	}

	/// One download attempt with its own first-byte cap, linked to
	/// the caller's signal - the mirror lane's single try (the
	/// hedged race below manages its own timers).
	async timedDownload(url, onProgress, signal, firstByteMs) {
		const controller = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, firstByteMs);
		const onAbort = () => controller.abort();
		if (signal) {
			signal.addEventListener("abort", onAbort, { once: true });
		}
		try {
			return await this.download(url, onProgress, controller.signal, () => {
				clearTimeout(timer);
				return true;
			});
		} catch (error) {
			if (timedOut && (!signal || !signal.aborted)) {
				// A timeout's raw AbortError would read as a user
				// cancel upstream - surface it as the failure it is
				throw new Error(`first-byte timeout via ${url}`);
			}
			throw error;
		} finally {
			clearTimeout(timer);
			if (signal) {
				signal.removeEventListener("abort", onAbort);
			}
		}
	}

	/// The model bytes for a token: the MIRROR first (one direct
	/// fetch, no metadata call), then the hedged gateway race below
	/// - re-raced ONCE automatically when the whole race fails. An
	/// abort rethrows immediately - the user cancelled, so nothing
	/// is retried.
	///
	/// - Parameters:
	///		- tokenId: The token whose model to fetch
	///		- onProgress: Optional (loaded, total) callback; total is
	///			0 when the gateway doesn't say
	///		- signal: Optional AbortSignal
	async fetchVRM(tokenId, onProgress, signal) {
		const key = String(tokenId);
		if (this.bytesCache.has(key)) {
			// Refresh the entry's LRU position
			const bytes = this.bytesCache.get(key);
			this.bytesCache.delete(key);
			this.bytesCache.set(key, bytes);
			return bytes;
		}
		// Mirror lane (docs/tads/vrm-mirror.md Decision 5): any
		// failure here falls through to the gateway race - the
		// mirror makes the happy path fast and self-owned, the race
		// stays the safety net
		const mirror = await this.mirrorURL(tokenId);
		if (mirror) {
			if (signal && signal.aborted) {
				throw new DOMException("aborted", "AbortError");
			}
			try {
				const bytes = await this.timedDownload(
					mirror,
					onProgress,
					signal,
					this.mirrorFirstByteMs,
				);
				this.cacheBytes(key, bytes);
				return bytes;
			} catch (error) {
				if (error && error.name === "AbortError" && signal && signal.aborted) {
					throw error;
				}
				console.warn(`VRM mirror miss for ${tokenId}`, error);
			}
		}
		const info = await this.vrmInfo(tokenId, signal);
		if (!info.url) {
			throw new Error("mirror unavailable and metadata has no vrm_url");
		}
		let bytes;
		try {
			bytes = await this.hedgedDownload(
				this.candidateURLs(info.url),
				onProgress,
				signal,
			);
		} catch (error) {
			// A user cancel is final. A failed RACE gets one more
			// round after a beat: with ipfs.io CORS-dead and
			// dweb.link's redirect broken (probed 2026-08-25), the
			// race often rides a single live gateway, and one
			// transient hiccup there must not fail the 3D view.
			if (error && error.name === "AbortError") {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
			if (signal && signal.aborted) {
				throw new DOMException("aborted", "AbortError");
			}
			bytes = await this.hedgedDownload(
				this.candidateURLs(info.url),
				onProgress,
				signal,
			);
		}
		this.cacheBytes(key, bytes);
		return bytes;
	}

	/// LRU-bounded byte cache shared by both lanes
	cacheBytes(key, bytes) {
		this.bytesCache.set(key, bytes);
		if (this.bytesCache.size > this.bytesCacheLimit) {
			const oldest = this.bytesCache.keys().next().value;
			this.bytesCache.delete(oldest);
		}
	}

	/// Hedged gateway race (field-measured: every public gateway
	/// hangs 20s+ on some CID some of the time, and dweb.link
	/// hard-fails on Qm CIDs - sequential attempts stalled the
	/// whole load behind one hung gateway). Gateways start
	/// staggerMs apart - or immediately when the previous attempt
	/// ERRORS - and the first one to deliver a body chunk becomes
	/// the winner; every other attempt aborts. Each attempt has a
	/// hard firstByteMs cap, so a hung gateway can never wedge the
	/// race. A winner that dies MID-stream gives up the crown and
	/// the race resumes with any candidates not yet started
	/// (already-aborted losers are gone - restarting them would
	/// re-download from zero on a lane that just lost anyway).
	/// Rejects only when every candidate has settled without a
	/// completed download.
	hedgedDownload(urls, onProgress, signal) {
		return new Promise((outerResolve, outerReject) => {
			if (signal && signal.aborted) {
				outerReject(new DOMException("aborted", "AbortError"));
				return;
			}
			if (!urls.length) {
				outerReject(new Error("no candidate URLs"));
				return;
			}
			const attempts = [];
			let started = 0;
			let settledCount = 0;
			let winner = null;
			let staggerTimer = null;
			// The most meaningful failure to reject with: a stale
			// race-loser abort must never masquerade as the reason
			// (its AbortError would read as a user cancel upstream)
			let lastError = null;
			const abortAll = () => {
				clearTimeout(staggerTimer);
				for (const attempt of attempts) {
					clearTimeout(attempt.timer);
					attempt.controller.abort();
				}
			};
			const onAbort = () => {
				abortAll();
				outerReject(new DOMException("aborted", "AbortError"));
			};
			// Settling detaches the abort listener: a long-lived
			// caller signal must not pin this race's closures alive
			const resolve = (bytes) => {
				if (signal) {
					signal.removeEventListener("abort", onAbort);
				}
				outerResolve(bytes);
			};
			const reject = (error) => {
				if (signal) {
					signal.removeEventListener("abort", onAbort);
				}
				outerReject(error);
			};
			if (signal) {
				signal.addEventListener("abort", onAbort, { once: true });
			}
			// One attempt is out of the race for good. Exactly once
			// per attempt (the settled flag): failures, race-loser
			// aborts, and dead ex-winners all funnel through here,
			// so "every candidate settled" is a sound reject gate.
			const settle = (attempt, url, error) => {
				if (attempt.settled) {
					return;
				}
				attempt.settled = true;
				settledCount++;
				// A genuine failure is anything except a pure
				// race-loser abort (a first-byte timeout aborts too,
				// but timedOut marks it as a real failure)
				const isGenuine =
					attempt.timedOut || !error || error.name !== "AbortError";
				if (isGenuine) {
					// A timeout's raw error is an AbortError, which the
					// caller's contract reads as USER cancel (silent, no
					// toast) - store it as the real failure it is
					lastError = attempt.timedOut
						? new Error(`first-byte timeout via ${url}`)
						: error;
					console.warn(`VRM fetch failed via ${url}`, lastError);
				}
				if (winner || (signal && signal.aborted)) {
					// Race is owned or cancelled: bookkeeping only
					return;
				}
				if (settledCount === urls.length) {
					clearTimeout(staggerTimer);
					reject(lastError || error);
					return;
				}
				// Fail fast: don't sit out the stagger on a dead lane
				startNext();
			};
			const startNext = () => {
				if (winner || started >= urls.length) {
					return;
				}
				clearTimeout(staggerTimer);
				const url = urls[started++];
				const controller = new AbortController();
				const attempt = { controller, timer: null, settled: false };
				attempts.push(attempt);
				// Hard cap on reaching the first body chunk; cleared
				// the moment this attempt wins
				attempt.timer = setTimeout(() => {
					attempt.timedOut = true;
					controller.abort();
				}, this.firstByteMs);
				this.download(
					url,
					(loaded, total) => {
						if (winner === attempt && onProgress) {
							onProgress(loaded, total);
						}
					},
					controller.signal,
					() => {
						// First chunk: the race is decided (single
						// threaded, so no tie is possible)
						if (winner) {
							return false;
						}
						winner = attempt;
						clearTimeout(attempt.timer);
						clearTimeout(staggerTimer);
						for (const other of attempts) {
							if (other !== attempt) {
								clearTimeout(other.timer);
								other.controller.abort();
							}
						}
						return true;
					},
				).then(
					(bytes) => {
						if (winner === attempt) {
							resolve(bytes);
						}
					},
					(error) => {
						clearTimeout(attempt.timer);
						if (winner === attempt) {
							// The winning stream died mid-download:
							// give up the crown and let settle()
							// resume the race with whatever remains
							winner = null;
						}
						settle(attempt, url, error);
					},
				);
				if (started < urls.length) {
					staggerTimer = setTimeout(startNext, this.staggerMs);
				}
			};
			startNext();
		});
	}

	/// One streamed download with progress reporting. onFirstChunk
	/// fires when the first body chunk lands; returning false means
	/// this attempt lost the gateway race and must stop consuming.
	async download(url, onProgress, signal, onFirstChunk) {
		const response = await fetch(url, { signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		const total = Number(response.headers.get("content-length")) || 0;
		const reader = response.body.getReader();
		const chunks = [];
		let loaded = 0;
		let isFirst = true;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			if (isFirst) {
				isFirst = false;
				if (onFirstChunk && !onFirstChunk()) {
					reader.cancel().catch(() => {});
					throw new DOMException("lost the gateway race", "AbortError");
				}
			}
			chunks.push(value);
			loaded += value.length;
			if (onProgress) {
				onProgress(loaded, total);
			}
		}
		if (isFirst) {
			// A 200 with an empty body never fires onFirstChunk, so
			// without this the attempt would neither win nor count
			// as failed - wedging the race bookkeeping
			throw new Error(`empty response body from ${url}`);
		}
		const bytes = new Uint8Array(loaded);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}
		return bytes.buffer;
	}
}
