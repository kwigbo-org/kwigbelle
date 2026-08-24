import {
	rarityIcon,
	tierForScore,
	kindLabel,
	flameIcon,
	BURNED_COLOR,
} from "./RarityIcons.js";

/// The Traits section of the side panel: one card per trait with
/// visibility checkboxes for drawn layers, plus the trait swap
/// preview affordances (Edit per card, "was" + undo on overridden
/// cards, Reset all). The render loop consults isLayerVisible /
/// isBackdropVisible each frame - visibility is display-only scene
/// state, so recomposition and the load machinery are untouched.
export default class TraitsSection {
	/// - Parameter callbacks: { onEdit(gene), onUndo(gene),
	///		onResetAll(), ubFor(tokenId) -> Promise,
	///		burnedFor(tokenId) -> Promise } - wired to the scene's
	///		override state and the frozen Unique-By / burned tables
	constructor(callbacks) {
		this.callbacks = callbacks || {};
		// The loaded token's burned-trait mask
		// (docs/tads/burned-traits.md): null until the async lookup
		// lands (or for replicants, which have no burn concept)
		this.burnedMask = null;
		this.hiddenLayers = new Set();
		this.isBackdropHidden = false;
		// 3D mode shows traits as read-only information: the model
		// can't change traits, so edit/undo/visibility are hidden and
		// rows show the ORIGINAL on-chain traits, not the preview
		this.isReadOnly = false;
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
		// Burn marks are token facts from the frozen table: reset,
		// then re-render once the mask lands (a token swap while the
		// lookup is in flight must not stamp the old token's mask)
		this.burnedMask = null;
		if (this.callbacks.burnedFor && avastar.tokenId != null) {
			const tokenAtStart = avastar.tokenId;
			this.callbacks.burnedFor(tokenAtStart).then((mask) => {
				if (this.currentTokenId !== tokenAtStart || mask === null) {
					return;
				}
				this.burnedMask = mask;
				this.rebuildRows();
			});
		}
		this.rebuildRows();
	}

	/// Whether the token's minted trait at a gene was burned
	isBurned(gene) {
		return this.burnedMask !== null && ((this.burnedMask >> gene) & 1) === 1;
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

	/// Switch the section between the interactive vector-mode cards
	/// and the informational 3D-mode cards. Override and visibility
	/// STATE is untouched - it just isn't shown or editable in 3D,
	/// and comes back exactly when the vector view returns.
	///
	/// - Parameter isReadOnly: Whether 3D mode is active
	setReadOnly(isReadOnly) {
		if (this.isReadOnly === isReadOnly) {
			return;
		}
		this.isReadOnly = isReadOnly;
		this.rebuildRows();
	}

	rebuildRows() {
		const avastar = this.avastar;
		this.content.innerHTML = "";
		if (!avastar) {
			return;
		}
		this.content.appendChild(this.identityCard());
		if (!avastar.layerInfo) {
			// The static fallback renders one unsliced image; the
			// identity chips above are hash-derived and still true
			const note = document.createElement("div");
			note.setAttribute("class", "traitNote");
			note.innerText = "Trait data unavailable for this display";
			this.content.appendChild(note);
			return;
		}
		if (this.isReadOnly) {
			// The 3D model always shows the token as minted: list the
			// BASELINE traits plainly, with no controls to mislead
			const note = document.createElement("div");
			note.setAttribute("class", "traitNote");
			note.innerText =
				"The 3D model shows the original on-chain Avastar. Trait " +
				"preview and visibility apply to the vector view.";
			this.content.appendChild(note);
			const baseline = this.baseline || avastar.traits;
			baseline.forEach((info, gene) => {
				this.content.appendChild(this.card(info, gene, { plain: true }));
			});
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

	/// The identity card (docs/tads/design-cues.md): token id, kind
	/// chip (Prime/Replicant/Founder/Exclusive), series chip in the
	/// series color, score + tier, and the trait distribution row.
	/// Score/series belong to the loaded TOKEN even under preview
	/// overrides; the distribution follows the DISPLAYED traits.
	identityCard() {
		const avastar = this.avastar;
		const card = document.createElement("div");
		card.setAttribute("class", "identityCard");
		const title = document.createElement("div");
		title.setAttribute("class", "identityTitle");
		title.innerText =
			avastar.tokenId != null ? `Avastar #${avastar.tokenId}` : "Avastar";
		card.appendChild(title);
		const chips = document.createElement("div");
		chips.setAttribute("class", "identityChips");
		if (avastar.kind) {
			const kind = document.createElement("span");
			const isPromo = avastar.kind === "prime" && Number(avastar.tokenId) < 200;
			kind.setAttribute(
				"class",
				"identityChip kindChip" + (isPromo ? " series-0" : ""),
			);
			kind.innerText = kindLabel(avastar.tokenId, avastar.kind);
			chips.appendChild(kind);
		}
		if (avastar.series !== null && avastar.series !== undefined) {
			const series = document.createElement("span");
			series.setAttribute(
				"class",
				`identityChip seriesChip series-${avastar.series}`,
			);
			series.innerText = `Gen 1 · Series ${avastar.series}`;
			chips.appendChild(series);
		}
		// A prime that never lent a trait to a replicant is in mint
		// condition — the collection's own vocabulary (metadata
		// attribute). Burned primes get a count line further down.
		if (this.burnedMask === 0) {
			const mint = document.createElement("span");
			mint.setAttribute("class", "identityChip mintChip");
			mint.innerText = "Mint condition";
			chips.appendChild(mint);
		}
		if (chips.childNodes.length > 0) {
			card.appendChild(chips);
		}
		if (typeof avastar.ranking === "number") {
			const score = document.createElement("div");
			score.setAttribute("class", "identityScore");
			const tier = tierForScore(avastar.ranking);
			score.appendChild(rarityIcon(tier.rarity));
			const text = document.createElement("span");
			text.innerText = `Score ${avastar.ranking} · ${tier.name}`;
			text.style.color = tier.color;
			score.appendChild(text);
			card.appendChild(score);
		}
		if (avastar.traits) {
			const dist = document.createElement("div");
			dist.setAttribute("class", "identityDist");
			const counts = [0, 0, 0, 0, 0];
			for (const trait of avastar.traits) {
				counts[trait.rarity]++;
			}
			counts.forEach((count, rarity) => {
				const item = document.createElement("span");
				item.setAttribute("class", "identityDistItem");
				item.appendChild(rarityIcon(rarity));
				const value = document.createElement("span");
				value.innerText = String(count);
				item.appendChild(value);
				dist.appendChild(item);
			});
			card.appendChild(dist);
		}
		if (this.burnedMask !== null && this.burnedMask !== 0) {
			let burnedCount = 0;
			for (let gene = 0; gene < 12; gene++) {
				if (this.isBurned(gene)) {
					burnedCount++;
				}
			}
			const burned = document.createElement("div");
			burned.setAttribute("class", "identityBurned");
			burned.appendChild(flameIcon());
			const text = document.createElement("span");
			text.innerText = `${burnedCount} of 12 traits burned`;
			text.style.color = BURNED_COLOR;
			burned.appendChild(text);
			card.appendChild(burned);
		}
		// Unique-By line: lottery primes only (the table has no
		// entry for founders/exclusives/replicants - they didn't
		// play the mint lottery). Fills in async from the frozen
		// table; a token swap re-renders the card, so a stale
		// resolve must find its own card still attached.
		if (this.callbacks.ubFor && avastar.tokenId != null) {
			this.callbacks.ubFor(avastar.tokenId).then((ub) => {
				if (!ub || !card.isConnected) {
					return;
				}
				const line = document.createElement("div");
				line.setAttribute("class", "identityUB");
				line.innerText = `Unique-By combos: 2-trait ${ub.u2} · 3-trait ${ub.u3}`;
				const qualifier = document.createElement("div");
				qualifier.setAttribute("class", "identityUBNote");
				qualifier.innerText = "(all 12 traits, among Series 1-5 primes)";
				card.appendChild(line);
				card.appendChild(qualifier);
			});
		}
		return card;
	}

	/// A trait card (layout per docs/tads/burned-traits.md Decision
	/// 6): top line = gene name (small, muted) with the rarity tier
	/// and any burned mark right-aligned; below it the trait VALUE,
	/// prominent. Layer traits get a visibility checkbox
	/// (options.onToggle); the color genes get a swatch of their
	/// primary tone (options.color) instead. Every card gets a
	/// labeled Edit pill; overridden cards additionally show
	/// "was: <original>" with an undo control (and the burn mark
	/// moves there — the burn belongs to the MINTED trait, not the
	/// previewed art).
	///
	/// - Parameters:
	///		- info: A trait record ({ geneName, name, rarityName })
	///		- gene: The gene slot (0-11) this card represents
	///		- options: { onToggle, checked } or { color }
	card(info, gene, options) {
		const isToggle = typeof options.onToggle === "function";
		const isEditable = this.callbacks.onEdit && !this.isReadOnly;
		// Always a div (never a <label>): the WHOLE CARD is the edit
		// tap target, so the checkbox must be its own island — a
		// label would toggle visibility on every card tap
		const row = document.createElement("div");
		row.setAttribute("class", isToggle ? "traitRow" : "traitRow info");
		if (isToggle) {
			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.checked = options.checked !== false;
			checkbox.addEventListener("change", () =>
				options.onToggle(checkbox.checked),
			);
			// A visibility tap must not also open the editor
			checkbox.addEventListener("click", (event) => event.stopPropagation());
			row.appendChild(checkbox);
		} else if (!options.plain) {
			const swatch = document.createElement("span");
			swatch.setAttribute("class", "traitSwatch");
			if (options.color) {
				swatch.style.backgroundColor = options.color;
			}
			row.appendChild(swatch);
		}
		const isOverridden =
			!this.isReadOnly &&
			this.overrides.has(gene) &&
			this.baseline &&
			this.baseline[gene];
		const text = document.createElement("span");
		text.setAttribute("class", "traitText");
		// Line 1: gene name, with the edit chip borrowing the empty
		// space at the end of the line instead of owning a column
		const top = document.createElement("span");
		top.setAttribute("class", "traitTop");
		const geneTitle = document.createElement("span");
		geneTitle.setAttribute("class", "traitGene");
		geneTitle.innerText = info.geneName;
		top.appendChild(geneTitle);
		if (isEditable) {
			const edit = document.createElement("span");
			edit.setAttribute("class", "traitEdit");
			edit.innerText = "✎ Edit";
			edit.addEventListener("click", (event) => {
				event.stopPropagation();
				this.callbacks.onEdit(gene);
			});
			top.appendChild(edit);
		}
		text.appendChild(top);
		// Line 2: the trait's name, the card's main line
		const value = document.createElement("span");
		value.setAttribute("class", "traitValue");
		value.innerText = info.name;
		text.appendChild(value);
		// Line 3: tags on their own full-width line — tier and burn
		// mark sit side by side and never crowd anything
		const tags = document.createElement("span");
		tags.setAttribute("class", "traitTags");
		const tag = document.createElement("span");
		tag.setAttribute("class", "traitRarity");
		if (typeof info.rarity === "number") {
			tag.appendChild(rarityIcon(info.rarity));
		}
		const tagName = document.createElement("span");
		tagName.innerText = info.rarityName || "";
		tag.appendChild(tagName);
		tags.appendChild(tag);
		// The burn mark sits with the tags while the card shows the
		// minted trait; an override moves it to the "was" line below
		if (this.isBurned(gene) && !isOverridden) {
			tags.appendChild(this.burnedTag());
		}
		text.appendChild(tags);
		if (isOverridden) {
			const was = document.createElement("span");
			was.setAttribute("class", "traitWas");
			const wasText = document.createElement("span");
			wasText.innerText = `was: ${this.baseline[gene].name}`;
			was.appendChild(wasText);
			if (this.isBurned(gene)) {
				was.appendChild(this.burnedTag());
			}
			const undo = document.createElement("span");
			undo.setAttribute("class", "traitUndo");
			undo.innerText = "↺ undo";
			undo.addEventListener("click", (event) => {
				event.stopPropagation();
				if (this.callbacks.onUndo) {
					this.callbacks.onUndo(gene);
				}
			});
			was.appendChild(undo);
			text.appendChild(was);
		}
		row.appendChild(text);
		if (isEditable) {
			// The whole card opens the editor (the chip is the hint)
			row.classList.add("editable");
			row.addEventListener("click", () => this.callbacks.onEdit(gene));
		}
		return row;
	}

	/// A small flame + BURNED tag
	burnedTag() {
		const burned = document.createElement("span");
		burned.setAttribute("class", "traitBurned");
		burned.appendChild(flameIcon());
		const label = document.createElement("span");
		label.innerText = "Burned";
		burned.appendChild(label);
		return burned;
	}
}
