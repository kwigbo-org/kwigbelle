import { stopSceneEvents } from "./UIHelpers.js";
import { progressText } from "./VRMSection.js";

/// The floating vector <-> 3D toggle button (docs/tads/
/// vrm-viewer.md): "3D" in vector mode, live progress while the
/// model fetches (a tap then cancels), "2D" while the model shows.
/// While loading, a centered overlay (the site's spinner plus a
/// phase line and progress bar) makes the wait unmistakable - the
/// button alone was too subtle for a ~9MB fetch. Pipeline failures
/// surface as a transient message beside the button.
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

		// The loading overlay: same spinner family as the preloader,
		// with a phase line, a progress bar, and a cancel hint.
		// pointer-events stay off so the toggle (cancel) and panel
		// remain tappable through it.
		this.loading = document.createElement("div");
		this.loading.setAttribute("id", "vrmLoading");
		this.loading.setAttribute("class", "centeredContainer");
		const spinner = document.createElement("div");
		spinner.setAttribute("class", "lds-circle");
		spinner.appendChild(document.createElement("div"));
		this.loading.appendChild(spinner);
		this.loadingText = document.createElement("div");
		this.loadingText.setAttribute("id", "vrmLoadingText");
		this.loading.appendChild(this.loadingText);
		this.loadingBar = document.createElement("div");
		this.loadingBar.setAttribute("id", "vrmLoadingBar");
		this.loadingFill = document.createElement("div");
		this.loadingFill.setAttribute("id", "vrmLoadingFill");
		this.loadingBar.appendChild(this.loadingFill);
		this.loading.appendChild(this.loadingBar);
		const hint = document.createElement("div");
		hint.setAttribute("id", "vrmLoadingHint");
		hint.innerText = "Tap the 3D button to cancel";
		this.loading.appendChild(hint);
		rootContainer.appendChild(this.loading);

		this.setMode("vector");
	}

	/// - Parameter mode: "vector" | "loading" | "3d"
	setMode(mode) {
		this.mode = mode;
		this.button.classList.toggle("loading", mode === "loading");
		this.loading.classList.toggle("visible", mode === "loading");
		if (mode === "loading") {
			this.button.innerText = "…";
			this.loadingText.innerText = "Loading 3D model…";
			this.loadingFill.style.width = "0%";
			this.loadingBar.classList.add("indeterminate");
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
		this.button.innerText = progressText(loaded, total);
		this.loadingText.innerText =
			"Loading 3D model… " + progressText(loaded, total);
		if (total > 0) {
			this.loadingBar.classList.remove("indeterminate");
			this.loadingFill.style.width =
				Math.min(100, Math.floor((loaded / total) * 100)) + "%";
		}
	}

	/// A post-fetch phase with no byte progress (parsing/mounting):
	/// keep the overlay honest instead of freezing at 100%
	///
	/// - Parameter text: The phase description
	setPhase(text) {
		if (this.mode !== "loading") {
			return;
		}
		this.loadingText.innerText = text;
		this.loadingBar.classList.remove("indeterminate");
		this.loadingFill.style.width = "100%";
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
