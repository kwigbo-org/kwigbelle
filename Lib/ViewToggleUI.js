import { stopSceneEvents } from "./UIHelpers.js";

/// The floating vector <-> 3D toggle button (docs/tads/
/// vrm-viewer.md): "3D" in vector mode, live progress while the
/// model fetches (a tap then cancels), "2D" while the model shows.
/// Pipeline failures surface as a transient message beside it.
export default class ViewToggleUI {
	/// - Parameters:
	///		- rootContainer: The element to attach to
	///		- onToggle: Called on every tap; the scene decides what
	///			the tap means for the current mode
	constructor(rootContainer, onToggle) {
		this.button = document.createElement("div");
		this.button.setAttribute("id", "viewToggle");
		stopSceneEvents(this.button);
		this.button.addEventListener("click", () => onToggle());
		rootContainer.appendChild(this.button);

		this.error = document.createElement("div");
		this.error.setAttribute("id", "viewToggleError");
		rootContainer.appendChild(this.error);

		this.setMode("vector");
	}

	/// - Parameter mode: "vector" | "loading" | "3d"
	setMode(mode) {
		this.mode = mode;
		this.button.classList.toggle("loading", mode === "loading");
		if (mode === "loading") {
			this.button.innerText = "…";
		} else if (mode === "3d") {
			this.button.innerText = "2D";
		} else {
			this.button.innerText = "3D";
		}
	}

	/// Live fetch progress; shown only while loading
	setProgress(loaded, total) {
		if (this.mode !== "loading") {
			return;
		}
		this.button.innerText =
			total > 0
				? Math.floor((loaded / total) * 100) + "%"
				: (loaded / 1048576).toFixed(1) + "MB";
	}

	/// A transient failure message beside the button
	showError(message) {
		this.error.innerText = message;
		this.error.classList.add("visible");
		clearTimeout(this.errorTimer);
		this.errorTimer = setTimeout(() => {
			this.error.classList.remove("visible");
		}, 4000);
	}
}
