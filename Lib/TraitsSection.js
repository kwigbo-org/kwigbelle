/// The Traits section of the side panel: one card per trait with
/// visibility checkboxes for drawn layers, plus the trait swap
/// preview affordances (Edit per card, "was" + undo on overridden
/// cards, Reset all). The render loop consults isLayerVisible /
/// isBackdropVisible each frame - visibility is display-only scene
/// state, so recomposition and the load machinery are untouched.
export default class TraitsSection {
	/// - Parameter callbacks: { onEdit(gene), onUndo(gene),
	///		onResetAll() } - wired to the scene's override state
	constructor(callbacks) {
		this.callbacks = callbacks || {};
		this.hiddenLayers = new Set();
		this.isBackdropHidden = false;
		// undefined (not null): a static-fallback avastar can carry a
		// null tokenId, and the first update must still build rows
		this.currentTokenId = undefined;
		this.baseline = null;
		this.overrides = new Map();
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

	/// Rebuild for a newly loaded Avastar. Same-token updates (e.g.
	/// a resize recompose) keep rows and state; a token swap resets
	/// visibility and override display.
	///
	/// - Parameter avastar: The scene's current display object
	update(avastar) {
		if (!avastar || avastar.tokenId === this.currentTokenId) {
			return;
		}
		this.currentTokenId = avastar.tokenId;
		this.hiddenLayers = new Set();
		this.isBackdropHidden = false;
		this.baseline = avastar.traits || null;
		this.overrides = new Map();
		this.avastar = avastar;
		this.rebuildRows();
	}

	/// Re-render after an override change on the SAME token. The
	/// preview-composed avastar carries the overridden traits;
	/// baseline stays what the token loaded with. Visibility state
	/// is preserved (indices are stable across overrides).
	///
	/// - Parameters:
	///		- avastar: The freshly preview-composed display object
	///		- overrides: Map<gene, pick> currently applied
	setOverrides(avastar, overrides) {
		this.avastar = avastar;
		this.overrides = overrides;
		this.rebuildRows();
	}

	rebuildRows() {
		const avastar = this.avastar;
		this.content.innerHTML = "";
		if (!avastar || !avastar.layerInfo) {
			// The static fallback renders one unsliced image
			const note = document.createElement("div");
			note.setAttribute("class", "traitNote");
			note.innerText = "Trait data unavailable for this display";
			this.content.appendChild(note);
			return;
		}
		if (this.overrides.size > 0) {
			const reset = document.createElement("div");
			reset.setAttribute("class", "resetAll");
			reset.innerText = "↺ Reset all traits";
			reset.addEventListener("click", () => {
				if (this.callbacks.onResetAll) {
					this.callbacks.onResetAll();
				}
			});
			this.content.appendChild(reset);
			const note = document.createElement("div");
			note.setAttribute("class", "traitNote");
			note.innerText = "Preview only — nothing is changed on chain.";
			this.content.appendChild(note);
		}
		// Genes 0-3 (skin tone, hair color, eye color, bg color) are
		// color styles applied across the art layers, not layers of
		// their own - shown with a swatch, no visibility checkbox
		if (avastar.traits) {
			for (let gene = 0; gene < 4; gene++) {
				const info = avastar.traits[gene];
				if (info) {
					this.content.appendChild(
						this.card(info, gene, {
							color: avastar.geneColors ? avastar.geneColors[gene] : null,
						}),
					);
				}
			}
		}
		if (avastar.backgroundLayer && avastar.traits && avastar.traits[4]) {
			this.content.appendChild(
				this.card(avastar.traits[4], 4, {
					checked: !this.isBackdropHidden,
					onToggle: (visible) => {
						this.isBackdropHidden = !visible;
					},
				}),
			);
		}
		avastar.layerInfo.forEach((info, index) => {
			this.content.appendChild(
				this.card(info, 5 + index, {
					checked: !this.hiddenLayers.has(index),
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
	/// swatch of their primary tone (options.color) instead. Every
	/// card gets an Edit button; overridden cards additionally show
	/// "was: <original>" with an undo control.
	///
	/// - Parameters:
	///		- info: A trait record ({ geneName, name, rarityName })
	///		- gene: The gene slot (0-11) this card represents
	///		- options: { onToggle, checked } or { color }
	card(info, gene, options) {
		const isToggle = typeof options.onToggle === "function";
		const row = document.createElement(isToggle ? "label" : "div");
		row.setAttribute("class", isToggle ? "traitRow" : "traitRow info");
		if (isToggle) {
			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.checked = options.checked !== false;
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
		const geneTitle = document.createElement("span");
		geneTitle.setAttribute("class", "traitGene");
		geneTitle.innerText = info.geneName;
		text.appendChild(geneTitle);
		const value = document.createElement("span");
		value.setAttribute("class", "traitValue");
		value.innerText = info.name;
		text.appendChild(value);
		const original =
			this.overrides.has(gene) && this.baseline && this.baseline[gene];
		if (original) {
			const was = document.createElement("span");
			was.setAttribute("class", "traitWas");
			const wasText = document.createElement("span");
			wasText.innerText = `was: ${original.name}`;
			was.appendChild(wasText);
			const undo = document.createElement("span");
			undo.setAttribute("class", "traitUndo");
			undo.innerText = "↺ undo";
			undo.addEventListener("click", (event) => {
				// The card may be a <label>: don't toggle visibility
				event.preventDefault();
				event.stopPropagation();
				if (this.callbacks.onUndo) {
					this.callbacks.onUndo(gene);
				}
			});
			was.appendChild(undo);
			text.appendChild(was);
		}
		row.appendChild(text);
		const side = document.createElement("span");
		side.setAttribute("class", "traitSide");
		const tag = document.createElement("span");
		tag.setAttribute("class", "traitRarity");
		tag.innerText = info.rarityName || "";
		side.appendChild(tag);
		if (this.callbacks.onEdit) {
			const edit = document.createElement("span");
			edit.setAttribute("class", "traitEdit");
			edit.innerText = "✎";
			edit.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.callbacks.onEdit(gene);
			});
			side.appendChild(edit);
		}
		row.appendChild(side);
		return row;
	}
}
