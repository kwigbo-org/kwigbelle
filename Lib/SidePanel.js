import { stopSceneEvents } from "./UIHelpers.js";

/// The right-side collapsible panel: a slim handle tab that slides
/// out a column of vertically collapsible sections. Sections are
/// registered through addSection, so future features (remix, etc.)
/// drop in without touching this class.
export default class SidePanel {
	/// - Parameter rootContainer: The element to attach the panel to
	constructor(rootContainer) {
		this.container = document.createElement("div");
		this.container.setAttribute("id", "sidePanel");
		stopSceneEvents(this.container);

		// The always-visible tab that opens and closes the panel
		this.handle = document.createElement("div");
		this.handle.setAttribute("id", "panelHandle");
		this.handle.innerText = "⚙";
		this.handle.addEventListener("click", () => this.toggle());
		this.container.appendChild(this.handle);

		this.sectionList = document.createElement("div");
		this.sectionList.setAttribute("id", "panelSections");
		this.container.appendChild(this.sectionList);

		rootContainer.appendChild(this.container);
	}

	/// Open or close the whole panel
	toggle() {
		this.container.classList.toggle("open");
	}

	/// Register a collapsible section
	///
	/// - Parameters:
	///		- title: The section header label
	///		- contentElement: The section body
	addSection(title, contentElement) {
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

		this.sectionList.appendChild(section);
	}
}
