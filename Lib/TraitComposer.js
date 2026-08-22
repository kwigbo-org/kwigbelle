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

	/// Compose a token into display layers.
	///
	/// - Parameters:
	///		- tokenId: The Avastar token id
	///		- displaySize: Size the layer images should render at
	///	- Returns: { backgroundLayer, layers, layerInfo, traits,
	///		backgroundColor, fullSVG } - a drop-in for the shape
	///		MainScene consumes from AvastarParser, plus trait
	///		metadata and the byte-exact full SVG.
	async compose(tokenId, displaySize) {
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
		const geneColors = fragments.slice(0, 4).map((fragment) => {
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
			// stale async results against it
			tokenId: String(tokenId),
			// Backdrop (gene 4) stretches to fill like the parser's
			// background bucket did
			backgroundLayer: this.toImage(styles + fragments[4], true, displaySize),
			layers,
			layerInfo,
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
