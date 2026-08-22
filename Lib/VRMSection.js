/// The "3D model" panel section (docs/tads/vrm-viewer.md): a short
/// explanation, a view-toggle button mirroring the floating one,
/// and - only when the connected wallet owns the displayed token -
/// a Download VRM button saving the model under its original name.
export default class VRMSection {
	/// - Parameters:
	///		- onToggle: Same action as the floating toggle
	///		- onDownload: Fetch and save the displayed token's model
	constructor(onToggle, onDownload) {
		this.onToggle = onToggle;
		this.onDownload = onDownload;
	}

	/// The section body element
	build() {
		const content = document.createElement("div");
		content.setAttribute("class", "loadControls");

		const note = document.createElement("div");
		note.setAttribute("class", "loadNote");
		note.innerText =
			"Every Avastar has an assigned 3D model (VRM), fetched from " +
			"IPFS on demand (~9MB).";
		content.appendChild(note);

		this.viewButton = document.createElement("button");
		this.viewButton.setAttribute("class", "loadButton vrmViewButton");
		this.viewButton.addEventListener("click", () => this.onToggle());
		content.appendChild(this.viewButton);

		this.progress = document.createElement("div");
		this.progress.setAttribute("class", "vrmProgress");
		content.appendChild(this.progress);

		this.download = document.createElement("button");
		this.download.setAttribute("class", "loadButton vrmDownload");
		this.download.innerText = "⬇ Download VRM";
		this.download.style.display = "none";
		this.download.addEventListener("click", () => this.onDownload());
		content.appendChild(this.download);

		this.setMode("vector");
		return content;
	}

	/// Mirror of the floating toggle's mode
	///
	/// - Parameter mode: "vector" | "loading" | "3d"
	setMode(mode) {
		this.mode = mode;
		if (mode === "loading") {
			this.viewButton.innerText = "Cancel loading";
			this.progress.style.display = "";
			this.progress.innerText = "Loading model…";
		} else {
			this.viewButton.innerText =
				mode === "3d" ? "Back to vector" : "View in 3D";
			this.progress.style.display = "none";
		}
	}

	/// Live fetch progress while loading into the 3D view
	setProgress(loaded, total) {
		if (this.mode !== "loading") {
			return;
		}
		this.progress.innerText = "Loading model… " + progressText(loaded, total);
	}

	/// Show the download button only for an owned token
	///
	/// - Parameter isOwned: Whether the connected wallet owns the
	///		displayed token
	setOwned(isOwned) {
		this.download.style.display = isOwned ? "" : "none";
	}

	/// Download progress/status line; null restores the idle button
	///
	/// - Parameter text: Status text, or null when done
	setDownloadState(text) {
		this.download.disabled = text !== null;
		this.download.innerText = text === null ? "⬇ Download VRM" : "⬇ " + text;
	}
}

/// "62%" when the size is known, a MB count otherwise
export function progressText(loaded, total) {
	return total > 0
		? Math.floor((loaded / total) * 100) + "%"
		: (loaded / 1048576).toFixed(1) + "MB";
}
