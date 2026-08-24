import { stopSceneEvents } from "./UIHelpers.js";

/// The right-side drawer stack (docs/tads/profile-drawer.md): a
/// column of always-visible handle tabs (profile above settings)
/// sharing one sliding content area, so only one drawer is open at
/// a time. The settings drawer is created on first addSection call,
/// keeping the original single-drawer registration surface for the
/// section classes.
export default class SidePanel {
	/// - Parameter rootContainer: The element to attach the panel to
	constructor(rootContainer) {
		this.container = document.createElement("div");
		this.container.setAttribute("id", "sidePanel");
		stopSceneEvents(this.container);

		// The stacked tabs, in registration order top to bottom
		this.handles = document.createElement("div");
		this.handles.setAttribute("id", "panelHandles");
		this.container.appendChild(this.handles);

		// The sliding area all drawer columns share
		this.columns = document.createElement("div");
		this.columns.setAttribute("id", "panelColumns");
		this.container.appendChild(this.columns);

		this.drawers = new Map();
		this.activeId = null;

		rootContainer.appendChild(this.container);
	}

	/// Register a drawer: a handle tab plus its own content column
	///
	/// - Parameters:
	///		- id: The drawer's name (open/close/badge address it)
	///		- handleContent: The tab face — a string or an element
	///		- options: { handleId, columnId, onOpen } — explicit DOM
	///			ids where other code or tests rely on them, and an
	///			open hook (e.g. lazy thumbnail loading)
	/// - Returns: The content column element
	addDrawer(id, handleContent, options = {}) {
		const handle = document.createElement("div");
		handle.setAttribute("class", "panelHandle");
		handle.setAttribute("id", options.handleId || `${id}Handle`);
		if (typeof handleContent === "string") {
			handle.innerText = handleContent;
		} else {
			handle.appendChild(handleContent);
		}
		handle.addEventListener("click", () => this.toggle(id));
		this.handles.appendChild(handle);

		const column = document.createElement("div");
		column.setAttribute("class", "panelColumn");
		if (options.columnId) {
			column.setAttribute("id", options.columnId);
		}
		this.columns.appendChild(column);

		this.drawers.set(id, { handle, column, onOpen: options.onOpen });
		return column;
	}

	/// A handle tap: close the open drawer, or switch/open to this one
	toggle(id) {
		if (this.isOpen(id)) {
			this.close();
			return;
		}
		this.open(id);
	}

	/// Open a drawer (closing whichever other one was showing)
	open(id) {
		const drawer = this.drawers.get(id);
		if (!drawer) {
			return;
		}
		this.activeId = id;
		for (const [key, entry] of this.drawers) {
			entry.column.classList.toggle("active", key === id);
			entry.handle.classList.toggle("active", key === id);
		}
		this.container.classList.add("open");
		if (drawer.onOpen) {
			drawer.onOpen();
		}
	}

	/// Slide the panel shut. The active column keeps its class so
	/// the content stays visible through the slide-out transition.
	close() {
		this.container.classList.remove("open");
		for (const entry of this.drawers.values()) {
			entry.handle.classList.remove("active");
		}
		this.activeId = null;
	}

	/// Whether a drawer is the one currently showing
	isOpen(id) {
		return this.activeId === id && this.container.classList.contains("open");
	}

	/// Show or hide the status badge dot on a drawer's handle
	/// (the profile tab's connected indicator)
	setBadge(id, isOn) {
		const drawer = this.drawers.get(id);
		if (drawer) {
			drawer.handle.classList.toggle("connected", isOn);
		}
	}

	/// Register a collapsible section in the settings drawer,
	/// creating that drawer on first use
	///
	/// - Parameters:
	///		- title: The section header label
	///		- contentElement: The section body
	/// - Returns: The section element, so callers can show/hide
	///		whole sections by mode (e.g. Effects in 3D)
	addSection(title, contentElement) {
		if (!this.drawers.has("settings")) {
			this.addDrawer("settings", "⚙", {
				handleId: "panelHandle",
				columnId: "panelSections",
			});
		}
		const section = document.createElement("div");
		section.setAttribute("class", "panelSection");

		const header = document.createElement("div");
		header.setAttribute("class", "panelSectionHeader");
		const label = document.createElement("span");
		label.innerText = title;
		header.appendChild(label);
		const chevron = document.createElement("span");
		chevron.setAttribute("class", "panelChevron");
		chevron.innerText = "▾";
		header.appendChild(chevron);
		header.addEventListener("click", () => {
			section.classList.toggle("collapsed");
		});
		section.appendChild(header);

		const body = document.createElement("div");
		body.setAttribute("class", "panelSectionBody");
		body.appendChild(contentElement);
		section.appendChild(body);

		this.drawers.get("settings").column.appendChild(section);
		return section;
	}
}
