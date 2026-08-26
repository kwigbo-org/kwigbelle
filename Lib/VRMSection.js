import { stopSceneEvents } from "./UIHelpers.js";

/// The "3D model" panel section (docs/tads/vrm-viewer.md): a short
/// explanation, a view-toggle button mirroring the floating one,
/// an info button opening the mirror-status modal (how much of the
/// VRM corpus is backed up - docs/tads/vrm-mirror.md Decision 10),
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

		const noteRow = document.createElement("div");
		noteRow.setAttribute("class", "vrmNoteRow");
		const note = document.createElement("div");
		note.setAttribute("class", "loadNote");
		note.innerText =
			"Every Avastar has an assigned 3D model (VRM), fetched from " +
			"IPFS on demand (~9MB).";
		noteRow.appendChild(note);
		const info = document.createElement("span");
		info.setAttribute("class", "vrmMirrorInfo");
		info.setAttribute("title", "VRM backup status");
		info.innerText = "ⓘ";
		info.addEventListener("click", () => this.openMirrorStatus());
		noteRow.appendChild(info);
		content.appendChild(noteRow);

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

	/// The mirror-status modal: fetches the capture-published
	/// vrm/_status.json (same origin - the mirror lives in the
	/// bucket the site is served from) and shows overall backup
	/// progress. Absent status renders a quiet fallback.
	async openMirrorStatus() {
		if (document.getElementById("mirrorModal")) {
			return;
		}
		const overlay = document.createElement("div");
		overlay.setAttribute("id", "mirrorModal");
		stopSceneEvents(overlay);
		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) {
				overlay.remove();
			}
		});
		const sheet = document.createElement("div");
		sheet.setAttribute("class", "modalSheet mirrorSheet");
		overlay.appendChild(sheet);
		const header = document.createElement("div");
		header.setAttribute("class", "modalHeader");
		const title = document.createElement("span");
		title.setAttribute("class", "modalTitle");
		title.innerText = "VRM backup";
		header.appendChild(title);
		const close = document.createElement("span");
		close.setAttribute("class", "modalClose");
		close.innerText = "✕";
		close.addEventListener("click", () => overlay.remove());
		header.appendChild(close);
		sheet.appendChild(header);
		const body = document.createElement("div");
		body.setAttribute("class", "mirrorBody");
		body.innerText = "Checking the mirror…";
		sheet.appendChild(body);
		document.body.appendChild(overlay);
		try {
			const res = await fetch("vrm/_status.json", { cache: "no-store" });
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			renderMirrorStatus(body, await res.json());
		} catch (error) {
			body.innerText =
				"The backup status isn't published yet - the mirror " +
				"capture hasn't reported from this site's bucket.";
		}
	}
}

/// Render the fetched status into the modal body: an overall bar
/// plus a per-front freshness line for each capture machine
function renderMirrorStatus(body, data) {
	const fronts = Object.values(data.fronts || {});
	const total = data.total > 0 ? data.total : 26617;
	const captured = fronts.reduce(
		(sum, front) => sum + (front.captured || 0),
		0,
	);
	const gaps = fronts.reduce((sum, front) => sum + (front.gaps || 0), 0);
	const bytes = fronts.reduce((sum, front) => sum + (front.bytes || 0), 0);
	const percent = Math.min(100, ((captured + gaps) / total) * 100);
	body.innerText = "";
	const bar = document.createElement("div");
	bar.setAttribute("class", "mirrorBar");
	const fill = document.createElement("div");
	fill.setAttribute("class", "mirrorBarFill");
	fill.style.width = percent.toFixed(1) + "%";
	bar.appendChild(fill);
	body.appendChild(bar);
	const line = (className, text) => {
		const element = document.createElement("div");
		element.setAttribute("class", className);
		element.innerText = text;
		body.appendChild(element);
	};
	line(
		"mirrorHeadline",
		`${captured.toLocaleString()} of ${total.toLocaleString()} ` +
			`models backed up (${percent.toFixed(1)}%)`,
	);
	line("mirrorDetail", `${(bytes / 1e9).toFixed(2)} GB safely mirrored`);
	for (const front of fronts) {
		if (front.until === undefined) {
			continue;
		}
		line(
			"mirrorFront",
			`Tokens ${front.from.toLocaleString()}–${(front.until - 1).toLocaleString()}: ` +
				`${(front.captured || 0).toLocaleString()} captured · ${agoText(front.updated)}`,
		);
	}
	line(
		"mirrorNote",
		"The models live on IPFS with a single remaining public " +
			"source; this backup preserves every one of them.",
	);
}

/// "just now" / "12m ago" / "3h ago" - defensive on bad input
function agoText(iso) {
	const at = Date.parse(iso);
	if (!Number.isFinite(at)) {
		return "updated";
	}
	const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
	if (minutes < 1) {
		return "just now";
	}
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	return `${Math.floor(minutes / 60)}h ago`;
}

/// "62%" when the size is known, a MB count otherwise
export function progressText(loaded, total) {
	return total > 0
		? Math.floor((loaded / total) * 100) + "%"
		: (loaded / 1048576).toFixed(1) + "MB";
}
