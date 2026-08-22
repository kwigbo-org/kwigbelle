import { stopSceneEvents, svgToImage } from "./UIHelpers.js";

/// The upper left thumbnail that expands into a picker listing
/// every Avastar the connected wallet owns. Loading the picked
/// Avastar stays the scene's job, reached through onPick.
export default class PickerUI {
	/// - Parameters:
	///		- rootContainer: The element to attach the picker to
	///		- avastarLoader: Source of thumbnails + the current SVG
	///		- onPick: Called with a tokenId when the user picks one
	constructor(rootContainer, avastarLoader, onPick) {
		this.rootContainer = rootContainer;
		this.avastarLoader = avastarLoader;
		this.onPick = onPick;
	}

	/// Build the collapsed thumbnail and the expandable list
	///
	/// - Parameter tokenIds: The owned token ids to list
	build(tokenIds) {
		// Rebuilding must not orphan a previous picker element and
		// its live listeners in the DOM
		if (this.picker) {
			this.picker.remove();
		}
		// A thumbnail loop from a previous build must neither block
		// this session's loads nor write into its cache/DOM: bump
		// the generation (stale loops check it and die) and clear
		// the in-flight flag alongside the other state
		this.buildGeneration = (this.buildGeneration || 0) + 1;
		this.isLoadingThumbnails = false;
		this.ownedTokenIds = tokenIds;
		this.thumbnailCache = {};
		this.pickerItems = {};

		this.picker = document.createElement("div");
		this.picker.setAttribute("id", "avastarPicker");
		stopSceneEvents(this.picker);

		// The always visible thumbnail showing the current Avastar
		this.selectedThumbnail = document.createElement("div");
		this.selectedThumbnail.setAttribute("class", "pickerThumb current");
		this.selectedThumbnail.addEventListener(
			"click",
			function () {
				this.toggle();
			}.bind(this),
		);
		this.picker.appendChild(this.selectedThumbnail);

		// The expandable list of owned Avastars
		this.pickerList = document.createElement("div");
		this.pickerList.setAttribute("id", "pickerList");
		for (const tokenId of tokenIds) {
			const item = document.createElement("div");
			item.setAttribute("class", "pickerThumb");
			const label = document.createElement("span");
			label.innerText = tokenId;
			item.appendChild(label);
			item.addEventListener(
				"click",
				function () {
					this.onPick(tokenId);
				}.bind(this),
			);
			this.pickerItems[tokenId] = item;
			this.pickerList.appendChild(item);
		}
		this.picker.appendChild(this.pickerList);
		this.rootContainer.appendChild(this.picker);
		// The first load may have completed before the picker
		// existed, so backfill the thumbnail
		this.updateSelectedThumbnail();
	}

	/// Expand or collapse the picker list. Thumbnails render
	/// lazily on first expand and are cached after that.
	toggle() {
		const isExpanded = this.pickerList.classList.toggle("expanded");
		if (isExpanded) {
			this.loadThumbnails();
		}
	}

	/// Collapse the expanded list (a picked Avastar starts loading)
	collapse() {
		if (this.pickerList) {
			this.pickerList.classList.remove("expanded");
		}
	}

	/// Render each owned Avastar into its picker thumbnail,
	/// one at a time to keep the wallet RPC happy
	async loadThumbnails() {
		if (this.isLoadingThumbnails) {
			return;
		}
		this.isLoadingThumbnails = true;
		const generation = this.buildGeneration;
		for (const tokenId of this.ownedTokenIds) {
			if (this.thumbnailCache[tokenId]) {
				continue;
			}
			try {
				const svgString = await this.avastarLoader.renderTokenSVG(tokenId);
				// The picker may have been rebuilt while the render
				// was in flight: a stale loop must not touch the new
				// session's cache, items, or in-flight flag
				if (generation !== this.buildGeneration) {
					return;
				}
				this.thumbnailCache[tokenId] = true;
				const item = this.pickerItems[tokenId];
				item.innerHTML = "";
				item.appendChild(svgToImage(svgString));
			} catch (error) {
				// Leave the token id label as the fallback thumbnail
				if (generation !== this.buildGeneration) {
					return;
				}
			}
		}
		if (generation === this.buildGeneration) {
			this.isLoadingThumbnails = false;
		}
	}

	/// Show the currently loaded Avastar in the collapsed thumbnail
	updateSelectedThumbnail() {
		if (!this.selectedThumbnail || !this.avastarLoader.currentAvastar) {
			return;
		}
		this.selectedThumbnail.innerHTML = "";
		this.selectedThumbnail.appendChild(
			svgToImage(this.avastarLoader.currentAvastar),
		);
	}
}
