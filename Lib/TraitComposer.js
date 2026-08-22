/// Composes an Avastar's display layers from the committed trait
/// library (Traits/) using only static file fetches - no wallet and
/// no contract calls. The trait hash for every token ships in the
/// deployed hash corpus, so any of the 26,617 Avastars is
/// composable instantly.
///
/// See docs/tads/trait-composition.md (Step 4).
export default class TraitComposer {
	constructor() {
		// traitId -> fragment string, kept across compositions so
		// resize and Avastar swaps don't refetch
		this.fragmentCache = new Map();
	}

	/// One time load of the library index, compose manifest, and
	/// hash corpus. Safe to call repeatedly.
	async loadLibrary() {
		if (this.libraryPromise === undefined) {
			this.libraryPromise = (async () => {
				const [index, manifest, hashes] = await Promise.all([
					fetch("./Traits/index.json").then((r) => r.json()),
					fetch("./Traits/compose.json").then((r) => r.json()),
					fetch("./Tools/data/hashes.json").then((r) => r.json()),
				]);
				this.manifest = manifest;
				this.hashes = hashes;
				// (generation:gene:variation) -> trait record
				this.byKey = new Map();
				for (const [traitId, info] of Object.entries(index)) {
					this.byKey.set(`${info.generation}:${info.gene}:${info.variation}`, {
						traitId,
						...info,
					});
				}
			})().catch((error) => {
				// Allow a retry on transient fetch failure
				this.libraryPromise = undefined;
				throw error;
			});
		}
		return this.libraryPromise;
	}

	/// Fetch one trait's SVG fragment (cached)
	async fragmentFor(trait) {
		if (!this.fragmentCache.has(trait.traitId)) {
			const response = await fetch(
				`./Traits/${trait.generation}/${trait.traitId}.svg`,
			);
			if (!response.ok) {
				throw new Error(`missing fragment for trait ${trait.traitId}`);
			}
			this.fragmentCache.set(trait.traitId, await response.text());
		}
		return this.fragmentCache.get(trait.traitId);
	}

	/// - Parameter tokenId: A token id to test
	/// - Returns: True when the token exists in the hash corpus
	async hasToken(tokenId) {
		await this.loadLibrary();
		return this.hashes[tokenId] !== undefined;
	}

	/// Every library trait that can occupy a gene slot, in stable
	/// variation order. Used by the trait edit modal.
	///
	/// - Parameter gene: The gene slot (0-11)
	/// - Returns: Array of trait records
	async traitsForGene(gene) {
		await this.loadLibrary();
		const records = [];
		for (const record of this.byKey.values()) {
			if (record.gene === gene) {
				records.push(record);
			}
		}
		records.sort((a, b) => a.variation - b.variation);
		return records;
	}

	/// Resolve a token's trait hash into its 12 trait records
	/// (gene-ordered: index = gene id).
	///
	/// - Parameter tokenId: The Avastar token id
	/// - Returns: Array of 12 trait records
	async picksFor(tokenId) {
		await this.loadLibrary();
		const entry = this.hashes[tokenId];
		if (!entry) {
			throw new Error(`no trait hash for token ${tokenId}`);
		}
		const traitsHash = BigInt(entry.traits);
		const picks = [];
		for (let gene = 0; gene < 12; gene++) {
			const variation = Number((traitsHash >> BigInt(gene * 8)) & 0xffn);
			const record = this.byKey.get(`${entry.generation}:${gene}:${variation}`);
			if (!record) {
				throw new Error(
					`trait ${entry.generation}:${gene}:${variation} not in library`,
				);
			}
			picks.push(record);
		}
		return picks;
	}

	/// Compose a token into display layers.
	///
	/// - Parameters:
	///		- tokenId: The Avastar token id
	///		- displaySize: Size the layer images should render at
	///	- Returns: The composePicks display object with tokenId set
	async compose(tokenId, displaySize) {
		const picks = await this.picksFor(tokenId);
		const composed = await this.composePicks(picks, displaySize);
		composed.tokenId = String(tokenId);
		return composed;
	}

	/// Compose an arbitrary set of trait picks into display layers.
	/// This is the surface the trait swap preview renders through -
	/// the picks need not correspond to any minted token.
	///
	/// - Parameters:
	///		- picks: 12 gene-ordered trait records (see picksFor)
	///		- displaySize: Size the layer images should render at
	///	- Returns: { tokenId: null, backgroundLayer, layers,
	///		layerInfo, traits, geneColors, backgroundColor, fullSVG }
	///		- the shape MainScene consumes; fullSVG stays the exact
	///		renderAvastar reconstruction for real-token picks.
	async composePicks(picks, displaySize) {
		await this.loadLibrary();
		const fragments = await Promise.all(picks.map((p) => this.fragmentFor(p)));
		// Genes 0-3 are the color style blocks; they must be present
		// in every layer document so class fills resolve
		const styles = fragments.slice(0, 4).join("");
		const bgMatch = fragments[3].match(
			/\.bg_color\s*\{\s*fill:\s*(#[0-9A-Fa-f]{3,8})/,
		);
		// Primary tone of each color gene (skin_fill, hair_fill,
		// eye_iris, bg_color are the first fill in their blocks) -
		// the trait panel shows these as swatches
		const geneColors = fragments.slice(0, 4).map((fragment, gene) => {
			// The bg swatch must always agree with the canvas
			// background: reuse the anchored .bg_color match
			if (gene === 3) {
				return bgMatch ? bgMatch[1] : null;
			}
			const match = fragment.match(/fill:\s*(#[0-9A-Fa-f]{3,8})/);
			return match ? match[1] : null;
		});
		const layers = [];
		const layerInfo = [];
		for (let gene = 5; gene < 12; gene++) {
			layers.push(this.toImage(styles + fragments[gene], false, displaySize));
			layerInfo.push(picks[gene]);
		}
		return {
			// The token this composition belongs to: consumers guard
			// stale async results against it. compose() fills it in;
			// preview compositions have no token.
			tokenId: null,
			// Backdrop (gene 4) stretches to fill like the parser's
			// background bucket did
			backgroundLayer: this.toImage(styles + fragments[4], true, displaySize),
			layers,
			layerInfo,
			// Gene-ordered by construction (index = gene id, 0-11);
			// TraitsSection relies on 0-3 being the color genes and
			// 4 the backdrop
			traits: picks,
			geneColors,
			backgroundColor: bgMatch ? bgMatch[1] : "#FFFFFF",
			// Byte-exact reconstruction of renderAvastar output
			fullSVG: this.manifest.header + fragments.join("") + this.manifest.footer,
		};
	}

	/// Build a layer Image. Headers mirror AvastarParser's
	/// createHeader so trait composition renders identically to the
	/// legacy slicing path.
	toImage(content, isBackground, displaySize) {
		const svgXMLNS = `xmlns="http://www.w3.org/2000/svg"`;
		const xlinkXMLNS = `xmlns:xlink="http://www.w3.org/1999/xlink"`;
		const aspect = `preserveAspectRatio="xMidYMid meet"`;
		const viewBox = `viewBox="0 0 1000 1000"`;
		const viewPort = isBackground
			? `width="100%" height="100%"`
			: `width="${displaySize.width}" height="${displaySize.height}"`;
		const svg =
			`<svg ${aspect} ${svgXMLNS} ${xlinkXMLNS} version="1.1" ${viewPort} ${viewBox}>` +
			content +
			"</svg>";
		const blob = new Blob([svg], { type: "image/svg+xml" });
		const url = URL.createObjectURL(blob);
		const image = new Image();
		image.src = url;
		const revoke = () => URL.revokeObjectURL(url);
		image.addEventListener("load", revoke, { once: true });
		image.addEventListener("error", revoke, { once: true });
		return image;
	}
}
