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
		if (avastar.backgroundLayer && avastar.traits && avastar.traits[4]) {
			const backdrop = avastar.traits[4];
			this.content.appendChild(
				this.traitRow(
					`${backdrop.geneName}: ${backdrop.name}`,
					backdrop.rarityName,
					(visible) => {
						this.isBackdropHidden = !visible;
					},
				),
			);
		}
		avastar.layerInfo.forEach((info, index) => {
			this.content.appendChild(
				this.traitRow(
					`${info.geneName}: ${info.name}`,
					info.rarityName,
					(visible) => {
						if (visible) {
							this.hiddenLayers.delete(index);
						} else {
							this.hiddenLayers.add(index);
						}
					},
				),
			);
		});
	}

	/// A row: checkbox + trait name + rarity tag
	traitRow(label, rarity, onChange) {
		const row = document.createElement("label");
		row.setAttribute("class", "traitRow");
		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.checked = true;
		checkbox.addEventListener("change", () => onChange(checkbox.checked));
		row.appendChild(checkbox);
		const name = document.createElement("span");
		name.setAttribute("class", "traitName");
		name.innerText = label;
		row.appendChild(name);
		const tag = document.createElement("span");
		tag.setAttribute("class", "traitRarity");
		tag.innerText = rarity || "";
		row.appendChild(tag);
		return row;
	}
}
