import { Strings } from "./Strings.js";
import { stopSceneEvents } from "./UIHelpers.js";
import { MIRROR_BASE } from "./VRMSource.js";

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
		note.innerText = Strings.vrm.note;
		noteRow.appendChild(note);
		const info = document.createElement("span");
		info.setAttribute("class", "vrmMirrorInfo");
		info.setAttribute("title", Strings.vrm.mirrorInfoTooltip);
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
		this.download.innerText = Strings.vrm.download;
		this.download.style.display = "none";
		this.download.addEventListener("click", () => this.onDownload());
		content.appendChild(this.download);

		// Per-token mirror indicator (operator request 2026-08-27):
		// green = this token's model is in the backup, red = not yet
		this.backupRow = document.createElement("div");
		this.backupRow.setAttribute("class", "vrmBackupRow");
		this.backupRow.style.display = "none";
		this.backupDot = document.createElement("span");
		this.backupDot.setAttribute("class", "vrmBackupDot");
		this.backupRow.appendChild(this.backupDot);
		this.backupText = document.createElement("span");
		this.backupText.setAttribute("class", "vrmBackupText");
		this.backupRow.appendChild(this.backupText);
		content.appendChild(this.backupRow);

		this.setMode("vector");
		return content;
	}

	/// Mirror of the floating toggle's mode
	///
	/// - Parameter mode: "vector" | "loading" | "3d"
	setMode(mode) {
		this.mode = mode;
		if (mode === "loading") {
			this.viewButton.innerText = Strings.vrm.cancelLoading;
			this.progress.style.display = "";
			this.progress.innerText = Strings.vrm.loadingShort;
		} else {
			this.viewButton.innerText =
				mode === "3d" ? Strings.vrm.backToVector : Strings.vrm.viewIn3D;
			this.progress.style.display = "none";
		}
	}

	/// Live fetch progress while loading into the 3D view
	setProgress(loaded, total) {
		if (this.mode !== "loading") {
			return;
		}
		this.progress.innerText = Strings.vrm.loadingShortProgress(
			progressText(loaded, total),
		);
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
		this.download.innerText =
			text === null ? Strings.vrm.download : Strings.vrm.downloadState(text);
	}

	/// Check the mirror for the displayed token's model and light
	/// the indicator: one HEAD of the mirror URL the serving lane
	/// itself uses - 200 means backed up, anything else means
	/// pending. A newer token load supersedes an in-flight check.
	/// KNOWN LIMIT (review-acknowledged): a gap token (no VRM ever
	/// minted) reads as perpetually pending - the client cannot
	/// know gap-ness without the metadata call this probe avoids.
	///
	/// - Parameter url: The absolute mirror URL, or null to hide
	async setMirrorCheck(url) {
		this.backupGeneration = (this.backupGeneration || 0) + 1;
		const generation = this.backupGeneration;
		if (!url) {
			this.backupRow.style.display = "none";
			return;
		}
		this.backupRow.style.display = "";
		this.backupDot.setAttribute("class", "vrmBackupDot checking");
		this.backupText.innerText = Strings.vrm.backupChecking;
		let isBacked = false;
		try {
			const res = await fetch(url, {
				method: "HEAD",
				cache: "no-store",
			});
			isBacked = res.ok;
		} catch (error) {
			// Unreachable mirror reads as pending, never as an error
		}
		if (generation !== this.backupGeneration) {
			return;
		}
		this.backupDot.setAttribute(
			"class",
			"vrmBackupDot " + (isBacked ? "backed" : "pending"),
		);
		this.backupText.innerText = isBacked
			? Strings.vrm.backedUp
			: Strings.vrm.backupPending;
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
		// A tap in here must not dismiss the side panel underneath
		overlay.classList.add("panelOverlay");
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
		title.innerText = Strings.mirror.title;
		header.appendChild(title);
		const close = document.createElement("span");
		close.setAttribute("class", "modalClose");
		close.innerText = "✕";
		close.addEventListener("click", () => overlay.remove());
		header.appendChild(close);
		sheet.appendChild(header);
		const body = document.createElement("div");
		body.setAttribute("class", "mirrorBody");
		body.innerText = Strings.mirror.checking;
		sheet.appendChild(body);
		document.body.appendChild(overlay);
		try {
			// The ABSOLUTE mirror status - identical from prod, stage,
			// and local dev (operator QA: the relative fetch read as
			// "not published" everywhere but prod)
			const res = await fetch(MIRROR_BASE + "_status.json", {
				cache: "no-store",
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			renderMirrorStatus(body, await res.json());
		} catch (error) {
			// Surfaces malformed status data in devtools instead of
			// silently reading as "not published" (review catch)
			console.warn("mirror status unavailable", error);
			body.innerText = Strings.mirror.notPublished;
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
	// The headline says "models backed up", so the percent and bar
	// count ONLY captured models (review catch); gaps - tokens with
	// no VRM to back up - get their own line below
	const percent = Math.min(100, (captured / total) * 100);
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
		Strings.mirror.headline(
			captured.toLocaleString(),
			total.toLocaleString(),
			percent.toFixed(1),
		),
	);
	line("mirrorDetail", Strings.mirror.gbMirrored((bytes / 1e9).toFixed(2)));
	if (gaps > 0) {
		line(
			"mirrorDetail",
			Strings.mirror.gapsLine(gaps.toLocaleString(), gaps === 1),
		);
	}
	for (const front of fronts) {
		if (front.from === undefined || front.until === undefined) {
			continue;
		}
		line(
			"mirrorFront",
			Strings.mirror.frontLine(
				front.from.toLocaleString(),
				(front.until - 1).toLocaleString(),
				(front.captured || 0).toLocaleString(),
				agoText(front.updated),
			),
		);
	}
	line("mirrorNote", Strings.mirror.note);
}

/// "just now" / "12m ago" / "3h ago" - defensive on bad input
function agoText(iso) {
	const at = Date.parse(iso);
	if (!Number.isFinite(at)) {
		return Strings.mirror.updatedFallback;
	}
	const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
	if (minutes < 1) {
		return Strings.mirror.justNow;
	}
	if (minutes < 60) {
		return Strings.mirror.minutesAgo(minutes);
	}
	return Strings.mirror.hoursAgo(Math.floor(minutes / 60));
}

/// "62%" when the size is known, a MB count otherwise
export function progressText(loaded, total) {
	return total > 0
		? Math.floor((loaded / total) * 100) + "%"
		: (loaded / 1048576).toFixed(1) + "MB";
}
