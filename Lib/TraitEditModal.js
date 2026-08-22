import { stopSceneEvents, svgToImage } from "./UIHelpers.js";

/// The trait chooser overlay: every library trait that can occupy a
/// gene slot, rendered as true thumbnails styled with the current
/// Avastar's colors (color slots show swatch tiles). Gendered art
/// is filtered to the base Avastar's gender + unisex by default,
/// with a "show all" toggle.
export default class TraitEditModal {
	/// - Parameter traitComposer: Source of trait records + fragments
	constructor(traitComposer) {
		this.traitComposer = traitComposer;
	}

	/// Show the chooser for one gene slot.
	///
	/// - Parameters:
	///		- gene: The gene slot (0-11)
	///		- currentPick: The trait currently in the slot
	///		- context: { gender, styles } - base Avastar gender
	///			(0 any / 1 male / 2 female) and the joined color
	///			style blocks for thumbnail rendering
	/// - Returns: The picked trait record, or null when dismissed
	open(gene, currentPick, context) {
		// One chooser at a time: a second Edit tap while a modal is
		// up (or still fetching) resolves immediately instead of
		// stacking overlays with racing resolutions
		if (this.isOpen) {
			return Promise.resolve(null);
		}
		this.isOpen = true;
		return new Promise((resolve) => {
			// A failed build must settle the promise - callers await
			// it, and a hung await would strand the edit flow
			this.buildOverlay(gene, currentPick, context, resolve).catch((error) => {
				console.warn("trait chooser failed to open", error);
				this.isOpen = false;
				resolve(null);
			});
		});
	}

	async buildOverlay(gene, currentPick, context, resolve) {
		const overlay = document.createElement("div");
		overlay.setAttribute("id", "traitModal");
		stopSceneEvents(overlay);
		const done = (pick) => {
			overlay.remove();
			this.isOpen = false;
			resolve(pick);
		};
		// Tapping the dimmed backdrop dismisses
		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) {
				done(null);
			}
		});

		const sheet = document.createElement("div");
		sheet.setAttribute("class", "modalSheet");
		overlay.appendChild(sheet);

		const header = document.createElement("div");
		header.setAttribute("class", "modalHeader");
		const title = document.createElement("span");
		title.setAttribute("class", "modalTitle");
		title.innerText = currentPick.geneName;
		header.appendChild(title);
		const showAll = document.createElement("label");
		showAll.setAttribute("class", "modalShowAll");
		const showAllBox = document.createElement("input");
		showAllBox.type = "checkbox";
		showAll.appendChild(showAllBox);
		const showAllText = document.createElement("span");
		showAllText.innerText = "show all";
		showAll.appendChild(showAllText);
		header.appendChild(showAll);
		const close = document.createElement("span");
		close.setAttribute("class", "modalClose");
		close.innerText = "✕";
		close.addEventListener("click", () => done(null));
		header.appendChild(close);
		sheet.appendChild(header);

		// Filter bar: free-text name match + rarity dropdown
		const filterBar = document.createElement("div");
		filterBar.setAttribute("class", "modalFilterBar");
		const textFilter = document.createElement("input");
		textFilter.setAttribute("class", "modalFilterText");
		textFilter.type = "text";
		textFilter.placeholder = "Filter by name";
		filterBar.appendChild(textFilter);
		const raritySelect = document.createElement("select");
		raritySelect.setAttribute("class", "modalFilterRarity");
		const anyRarity = document.createElement("option");
		anyRarity.value = "";
		anyRarity.innerText = "Any rarity";
		raritySelect.appendChild(anyRarity);
		filterBar.appendChild(raritySelect);
		sheet.appendChild(filterBar);

		const grid = document.createElement("div");
		grid.setAttribute("class", "modalGrid");
		sheet.appendChild(grid);

		// Mount BEFORE fetching the trait list: a transient library
		// failure then dismisses a visible (empty) modal instead of
		// silently never showing one
		document.body.appendChild(overlay);
		let all = null;
		try {
			all = await this.traitComposer.traitsForGene(gene);
		} catch (error) {
			console.warn("trait list unavailable", error);
			done(null);
			return;
		}
		// Rarity options come from the slot's actual traits, in
		// ascending rarity order
		const rarities = [...new Map(all.map((r) => [r.rarity, r.rarityName]))]
			.sort((a, b) => a[0] - b[0])
			.map(([, name]) => name);
		for (const rarityName of rarities) {
			const option = document.createElement("option");
			option.value = rarityName;
			option.innerText = rarityName;
			raritySelect.appendChild(option);
		}
		const renderOptions = async () => {
			// Rapid filter changes: only the latest render may keep
			// filling thumbnails; superseded runs stop at their next
			// batch instead of decoding into detached nodes
			this.renderGeneration = (this.renderGeneration || 0) + 1;
			const generation = this.renderGeneration;
			grid.innerHTML = "";
			const text = textFilter.value.trim().toLowerCase();
			const rarity = raritySelect.value;
			// Gender 0 traits are unisex; a gender-0 base sees all
			const options = all.filter(
				(record) =>
					(showAllBox.checked ||
						record.gender === 0 ||
						!context.gender ||
						record.gender === context.gender) &&
					(!rarity || record.rarityName === rarity) &&
					(!text || record.name.toLowerCase().includes(text)),
			);
			const tiles = options.map((record) =>
				this.optionTile(record, gene, currentPick, context, done),
			);
			for (const tile of tiles) {
				grid.appendChild(tile.element);
			}
			// Thumbnails render lazily in small batches so 78-option
			// slots don't fetch and rasterize everything in one burst
			const BATCH = 12;
			for (let start = 0; start < tiles.length; start += BATCH) {
				// The overlay may have been dismissed or re-rendered
				if (!overlay.isConnected || generation !== this.renderGeneration) {
					return;
				}
				await Promise.all(
					tiles.slice(start, start + BATCH).map((tile) => tile.fill()),
				);
			}
		};
		showAllBox.addEventListener("change", () => renderOptions());
		textFilter.addEventListener("input", () => renderOptions());
		raritySelect.addEventListener("change", () => renderOptions());
		renderOptions();
	}

	/// One selectable option: preview area (thumbnail or swatch),
	/// name, rarity. fill() loads the preview lazily.
	optionTile(record, gene, currentPick, context, done) {
		const element = document.createElement("div");
		element.setAttribute(
			"class",
			record.traitId === currentPick.traitId
				? "modalOption current"
				: "modalOption",
		);
		element.addEventListener("click", () => done(record));
		const preview = document.createElement("div");
		preview.setAttribute("class", "modalPreview");
		element.appendChild(preview);
		const name = document.createElement("span");
		name.setAttribute("class", "modalOptionName");
		name.innerText = record.name;
		element.appendChild(name);
		const tag = document.createElement("span");
		tag.setAttribute("class", "traitRarity");
		tag.innerText = record.rarityName || "";
		element.appendChild(tag);

		const fill = async () => {
			try {
				const fragment = await this.traitComposer.fragmentFor(record);
				if (gene < 4) {
					// Color slots: a swatch of the primary tone (the
					// bg gene anchors on .bg_color like the composer)
					const match =
						gene === 3
							? fragment.match(/\.bg_color\s*\{\s*fill:\s*(#[0-9A-Fa-f]{3,8})/)
							: fragment.match(/fill:\s*(#[0-9A-Fa-f]{3,8})/);
					const swatch = document.createElement("span");
					swatch.setAttribute("class", "modalSwatch");
					if (match) {
						swatch.style.backgroundColor = match[1];
					}
					preview.appendChild(swatch);
					return;
				}
				// Art slots: the real fragment styled with the CURRENT
				// Avastar's colors, so the preview is true to this face
				const svg =
					`<svg xmlns="http://www.w3.org/2000/svg" ` +
					`xmlns:xlink="http://www.w3.org/1999/xlink" ` +
					`preserveAspectRatio="xMidYMid meet" ` +
					`width="160" height="160" viewBox="0 0 1000 1000">` +
					context.styles +
					fragment +
					"</svg>";
				preview.appendChild(svgToImage(svg));
			} catch (error) {
				// Leave the name as the fallback preview
			}
		};
		return { element, fill };
	}
}
