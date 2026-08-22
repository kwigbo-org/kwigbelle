/// The Traits section of the side panel: one row per drawn layer
/// with the trait's name and rarity and a visibility checkbox, plus
/// a Backdrop row. The render loop consults isLayerVisible /
/// isBackdropVisible each frame - visibility is display-only scene
/// state, so recomposition and the load machinery are untouched.
export default class TraitsSection {
	constructor() {
		this.hiddenLayers = new Set();
		this.isBackdropHidden = false;
		// undefined (not null): a static-fallback avastar can carry a
		// null tokenId, and the first update must still build rows
		this.currentTokenId = undefined;
		this.content = document.createElement("div");
		this.content.setAttribute("class", "traitRows");
	}

	/// The section body element (rows are rebuilt into it per token)
	build() {
		return this.content;
	}

	/// - Parameter index: The layer index to test
	isLayerVisible(index) {
		return !this.hiddenLayers.has(index);
	}

	isBackdropVisible() {
		return !this.isBackdropHidden;
	}

	/// Rebuild the rows for a newly loaded Avastar. Same-token
	/// updates (e.g. a resize recompose) keep the rows and the
	/// visibility state; a token swap resets both - hiding a trait
	/// on one Avastar must not carry over to the next.
	///
	/// - Parameter avastar: The scene's current display object
	update(avastar) {
		if (!avastar || avastar.tokenId === this.currentTokenId) {
			return;
		}
		this.currentTokenId = avastar.tokenId;
		this.hiddenLayers = new Set();
		this.isBackdropHidden = false;
		this.content.innerHTML = "";
		if (!avastar.layerInfo) {
			// The static fallback renders one unsliced image
			const note = document.createElement("div");
			note.setAttribute("class", "traitNote");
			note.innerText = "Trait data unavailable for this display";
			this.content.appendChild(note);
			return;
		}
		// Genes 0-3 (skin tone, hair color, eye color, bg color) are
		// color styles applied across the art layers, not layers of
		// their own - shown for completeness, with no visibility
		// checkbox because there is nothing to hide
		if (avastar.traits) {
			for (let gene = 0; gene < 4; gene++) {
				const info = avastar.traits[gene];
				if (info) {
					this.content.appendChild(
						this.card(info, {
							color: avastar.geneColors ? avastar.geneColors[gene] : null,
						}),
					);
				}
			}
		}
		if (avastar.backgroundLayer && avastar.traits && avastar.traits[4]) {
			this.content.appendChild(
				this.card(avastar.traits[4], {
					onToggle: (visible) => {
						this.isBackdropHidden = !visible;
					},
				}),
			);
		}
		avastar.layerInfo.forEach((info, index) => {
			this.content.appendChild(
				this.card(info, {
					onToggle: (visible) => {
						if (visible) {
							this.hiddenLayers.delete(index);
						} else {
							this.hiddenLayers.add(index);
						}
					},
				}),
			);
		});
	}

	/// A trait card: the gene as a bold title with the trait value
	/// below it and the rarity tag on the right. Layer traits get a
	/// visibility checkbox (options.onToggle); the color genes get a
	/// swatch of their primary tone (options.color) instead.
	///
	/// - Parameters:
	///		- info: A trait record ({ geneName, name, rarityName })
	///		- options: { onToggle } or { color }
	card(info, options) {
		const isToggle = typeof options.onToggle === "function";
		const row = document.createElement(isToggle ? "label" : "div");
		row.setAttribute("class", isToggle ? "traitRow" : "traitRow info");
		if (isToggle) {
			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.checked = true;
			checkbox.addEventListener("change", () =>
				options.onToggle(checkbox.checked),
			);
			row.appendChild(checkbox);
		} else {
			const swatch = document.createElement("span");
			swatch.setAttribute("class", "traitSwatch");
			if (options.color) {
				swatch.style.backgroundColor = options.color;
			}
			row.appendChild(swatch);
		}
		const text = document.createElement("span");
		text.setAttribute("class", "traitText");
		const gene = document.createElement("span");
		gene.setAttribute("class", "traitGene");
		gene.innerText = info.geneName;
		text.appendChild(gene);
		const value = document.createElement("span");
		value.setAttribute("class", "traitValue");
		value.innerText = info.name;
		text.appendChild(value);
		row.appendChild(text);
		const tag = document.createElement("span");
		tag.setAttribute("class", "traitRarity");
		tag.innerText = info.rarityName || "";
		row.appendChild(tag);
		return row;
	}
}
