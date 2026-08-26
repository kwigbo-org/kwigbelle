import { Strings } from "./Strings.js";
import { stopSceneEvents } from "./UIHelpers.js";
import { progressText } from "./VRMSection.js";

/// Center-screen VRM loading feedback (docs/tads/vrm-viewer.md,
/// reshaped by docs/tads/profile-drawer.md): the site's spinner
/// with a phase line and progress bar for the ~9MB fetch + parse.
/// With the floating 3D button retired, the overlay itself is the
/// cancel affordance — a tap anywhere on it cancels — and pipeline
/// failures surface as a transient bottom-center toast.
export default class VRMLoadingUI {
	/// - Parameters:
	///		- rootContainer: The element to attach to
	///		- onCancel: Called when the overlay is tapped mid-load;
	///			the scene turns that into a fetch cancel
	constructor(rootContainer, onCancel) {
		this.loading = document.createElement("div");
		this.loading.setAttribute("id", "vrmLoading");
		this.loading.setAttribute("class", "centeredContainer");
		// A tap here cancels the load; it must not also dismiss the
		// side panel underneath
		this.loading.classList.add("panelOverlay");
		stopSceneEvents(this.loading);
		this.loading.addEventListener("click", () => onCancel());
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
		hint.innerText = Strings.vrm.tapToCancel;
		this.loading.appendChild(hint);
		rootContainer.appendChild(this.loading);

		this.toast = document.createElement("div");
		this.toast.setAttribute("id", "vrmToast");
		rootContainer.appendChild(this.toast);

		this.setMode("vector");
	}

	/// - Parameter mode: "vector" | "loading" | "3d" — the overlay
	///		shows only while loading
	setMode(mode) {
		this.mode = mode;
		this.loading.classList.toggle("visible", mode === "loading");
		if (mode === "loading") {
			this.loadingText.innerText = Strings.vrm.loadingFull;
			this.loadingFill.style.width = "0%";
			this.loadingBar.classList.add("indeterminate");
		}
	}

	/// Live fetch progress; shown only while loading
	setProgress(loaded, total) {
		if (this.mode !== "loading") {
			return;
		}
		this.loadingText.innerText = Strings.vrm.loadingFullProgress(
			progressText(loaded, total),
		);
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

	/// A transient failure toast at the bottom center
	showError(message) {
		this.toast.innerText = message;
		this.toast.classList.add("visible");
		clearTimeout(this.errorTimer);
		this.errorTimer = setTimeout(() => {
			this.toast.classList.remove("visible");
		}, 4000);
	}
}
