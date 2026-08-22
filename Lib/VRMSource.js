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
	/// fetched as published rather than rejected)
	///
	/// - Parameter url: The published vrm_url
	candidateURLs(url) {
		const match = url.match(/\/ipfs\/(.+)$/);
		if (!match) {
			return [url];
		}
		return this.gateways.map((gateway) => gateway + match[1]);
	}

	/// The model bytes for a token. Gateways advance on any failure
	/// except an abort, which rethrows immediately - the user
	/// cancelled, so no gateway should be retried.
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
		let lastError = null;
		for (const url of this.candidateURLs(info.url)) {
			try {
				const bytes = await this.download(url, onProgress, signal);
				this.bytesCache.set(key, bytes);
				if (this.bytesCache.size > this.bytesCacheLimit) {
					const oldest = this.bytesCache.keys().next().value;
					this.bytesCache.delete(oldest);
				}
				return bytes;
			} catch (error) {
				if (error && error.name === "AbortError") {
					throw error;
				}
				console.warn(`VRM fetch failed via ${url}`, error);
				lastError = error;
			}
		}
		throw lastError || new Error("no VRM source produced bytes");
	}

	/// One streamed download with progress reporting
	async download(url, onProgress, signal) {
		const response = await fetch(url, { signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		const total = Number(response.headers.get("content-length")) || 0;
		const reader = response.body.getReader();
		const chunks = [];
		let loaded = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
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
