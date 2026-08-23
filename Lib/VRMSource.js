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

/// Where a token's 3D model comes from (docs/tads/vrm-viewer.md):
/// the avastars.io metadata endpoint names the .vrm on IPFS, and
/// the bytes stream through a gateway fallback list with progress
/// reporting and a small in-memory cache (~9.3MB per model, so
/// nothing is fetched until asked).
export default class VRMSource {
	constructor() {
		this.metadataURL = "https://avastars.io/metadata/";
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
	}

	/// The model URL and original filename for a token, from the
	/// metadata endpoint (cached per token; the endpoint echoes the
	/// requesting origin, so the browser can call it directly)
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
		const response = await fetch(this.metadataURL + key, { signal });
		if (!response.ok) {
			throw new Error(`metadata request failed (HTTP ${response.status})`);
		}
		const metadata = await response.json();
		if (!metadata.vrm_url) {
			throw new Error("metadata has no vrm_url");
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

	/// The model bytes for a token, via the hedged gateway race
	/// below. An abort rethrows immediately - the user cancelled,
	/// so nothing is retried.
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
		const info = await this.vrmInfo(tokenId, signal);
		const bytes = await this.hedgedDownload(
			this.candidateURLs(info.url),
			onProgress,
			signal,
		);
		this.bytesCache.set(key, bytes);
		if (this.bytesCache.size > this.bytesCacheLimit) {
			const oldest = this.bytesCache.keys().next().value;
			this.bytesCache.delete(oldest);
		}
		return bytes;
	}

	/// Hedged gateway race (field-measured: every public gateway
	/// hangs 20s+ on some CID some of the time, and dweb.link
	/// hard-fails on Qm CIDs - sequential attempts stalled the
	/// whole load behind one hung gateway). Gateways start
	/// staggerMs apart - or immediately when the previous attempt
	/// ERRORS - and the first one to deliver a body chunk wins;
	/// every other attempt aborts. Each attempt also has a hard
	/// firstByteMs cap, so a hung gateway can never wedge the
	/// race. Rejects only when every candidate has failed.
	hedgedDownload(urls, onProgress, signal) {
		return new Promise((resolve, reject) => {
			if (signal && signal.aborted) {
				reject(new DOMException("aborted", "AbortError"));
				return;
			}
			const attempts = [];
			let started = 0;
			let failedCount = 0;
			let winner = null;
			let staggerTimer = null;
			const abortAll = () => {
				clearTimeout(staggerTimer);
				for (const attempt of attempts) {
					clearTimeout(attempt.timer);
					attempt.controller.abort();
				}
			};
			if (signal) {
				signal.addEventListener(
					"abort",
					() => {
						abortAll();
						reject(new DOMException("aborted", "AbortError"));
					},
					{ once: true },
				);
			}
			const failOne = (url, error) => {
				console.warn(`VRM fetch failed via ${url}`, error);
				failedCount++;
				if (failedCount === urls.length) {
					clearTimeout(staggerTimer);
					reject(error);
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
				const attempt = { controller, timer: null };
				attempts.push(attempt);
				// Hard cap on reaching the first body chunk; cleared
				// the moment this attempt wins
				attempt.timer = setTimeout(() => controller.abort(), this.firstByteMs);
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
							// The winning stream died mid-download
							reject(error);
							return;
						}
						if (winner || (signal && signal.aborted)) {
							// Aborted as a race loser / caller cancel
							return;
						}
						failOne(url, error);
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
		const bytes = new Uint8Array(loaded);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}
		return bytes.buffer;
	}
}
