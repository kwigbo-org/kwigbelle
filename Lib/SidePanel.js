import { stopSceneEvents } from "./UIHelpers.js";

const SVG_NS = "http://www.w3.org/2000/svg";

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
	///		- options: { handleId, columnId, onOpen, statusDot } —
	///			explicit DOM ids where other code or tests rely on
	///			them, an open hook (e.g. lazy thumbnail loading), and
	///			whether the handle carries an always-visible status
	///			dot (grey until setBadge lights it green)
	/// - Returns: The content column element
	addDrawer(id, handleContent, options = {}) {
		const handle = document.createElement("div");
		handle.setAttribute("class", "panelHandle");
		if (options.statusDot) {
			handle.classList.add("statusDot");
		}
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

	/// The settings tab's face: a gear as inline SVG. A text "⚙"
	/// gets swapped for the platform's COLOR EMOJI on mobile;
	/// currentColor SVG stays the chrome's white everywhere.
	static settingsIcon() {
		const svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("class", "handleIcon");
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute(
			"d",
			"M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03" +
				"-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l" +
				"-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0" +
				"-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57" +
				"-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21" +
				"-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l" +
				"-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l" +
				"2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h" +
				"3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l" +
				"2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l" +
				"-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 " +
				"3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
		);
		path.setAttribute("fill", "currentColor");
		svg.appendChild(path);
		return svg;
	}

	/// The info tab's face: an i-in-circle as inline SVG (same
	/// currentColor treatment as the gear, for the same mobile
	/// color-emoji reason)
	static infoIcon() {
		const svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("class", "handleIcon");
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute(
			"d",
			"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 " +
				"12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 " +
				"8zm-1-11h2V7h-2v2zm0 8h2v-6h-2v6z",
		);
		path.setAttribute("fill", "currentColor");
		svg.appendChild(path);
		return svg;
	}

	/// The stored collapsed-section titles, per browser
	/// (docs/tads/burned-traits.md Decision 7)
	static PANELS_KEY = "kwigbelle.panels";

	loadCollapsed() {
		try {
			return JSON.parse(localStorage.getItem(SidePanel.PANELS_KEY)) || {};
		} catch (error) {
			return {};
		}
	}

	saveCollapsed(title, isCollapsed) {
		try {
			const stored = this.loadCollapsed();
			if (isCollapsed) {
				stored[title] = true;
			} else {
				delete stored[title];
			}
			localStorage.setItem(SidePanel.PANELS_KEY, JSON.stringify(stored));
		} catch (error) {
			// Storage unavailable: collapse state just won't persist
		}
	}

	/// Register a collapsible section in a lazily-created drawer.
	/// Known drawer ids: "settings" (default, the original surface)
	/// and "info" (docs/tads/info-tab.md Decision 1). Drawers stack
	/// in creation order, so callers order the tabs by registering
	/// their first sections in stack order.
	///
	/// - Parameters:
	///		- title: The section header label
	///		- contentElement: The section body
	///		- drawerId: Which drawer hosts the section
	/// - Returns: The section element, so callers can show/hide
	///		whole sections by mode (e.g. Effects in 3D)
	addSection(title, contentElement, drawerId = "settings") {
		if (!this.drawers.has(drawerId)) {
			if (drawerId === "info") {
				this.addDrawer("info", SidePanel.infoIcon(), {
					handleId: "infoHandle",
					columnId: "infoSections",
				});
			} else {
				this.addDrawer("settings", SidePanel.settingsIcon(), {
					handleId: "panelHandle",
					columnId: "panelSections",
				});
			}
		}
		const section = document.createElement("div");
		section.setAttribute("class", "panelSection");
		// A section the user collapsed stays collapsed across visits
		if (this.loadCollapsed()[title]) {
			section.classList.add("collapsed");
		}

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
			const isCollapsed = section.classList.toggle("collapsed");
			this.saveCollapsed(title, isCollapsed);
		});
		section.appendChild(header);

		const body = document.createElement("div");
		body.setAttribute("class", "panelSectionBody");
		body.appendChild(contentElement);
		section.appendChild(body);

		this.drawers.get(drawerId).column.appendChild(section);
		return section;
	}
}
