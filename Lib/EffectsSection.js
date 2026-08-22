/// The Effects section of the side panel: user controls for the
/// spring rig, persisted per browser in localStorage so a visitor's
/// preferred feel survives reloads.
export default class EffectsSection {
	static STORAGE_KEY = "kwigbelle.effects";

	/// - Parameters:
	///		- layerSprings: The rig the controls drive
	///		- explodeOverride: The ?explode url param when explicitly
	///			present (wins over the stored setting), else null
	constructor(layerSprings, explodeOverride) {
		this.layerSprings = layerSprings;
		const stored = this.loadSettings();
		if (stored) {
			this.layerSprings.isExplodeEnabled = !!stored.explode;
			this.layerSprings.isPaused = !!stored.paused;
			if (Number.isFinite(stored.motion)) {
				this.layerSprings.motionScale = stored.motion;
			}
			if (Number.isFinite(stored.follow)) {
				this.layerSprings.followScale = stored.follow;
			}
		}
		if (explodeOverride !== null) {
			this.layerSprings.isExplodeEnabled = explodeOverride;
		}
	}

	loadSettings() {
		try {
			return JSON.parse(localStorage.getItem(EffectsSection.STORAGE_KEY));
		} catch (error) {
			return null;
		}
	}

	saveSettings() {
		try {
			localStorage.setItem(
				EffectsSection.STORAGE_KEY,
				JSON.stringify({
					explode: this.layerSprings.isExplodeEnabled,
					paused: this.layerSprings.isPaused,
					motion: this.layerSprings.motionScale,
					follow: this.layerSprings.followScale,
				}),
			);
		} catch (error) {
			// Storage unavailable: settings just won't persist
		}
	}

	/// Build the section body
	build() {
		const content = document.createElement("div");
		content.setAttribute("class", "effectsControls");
		content.appendChild(
			this.toggleRow("Explode", this.layerSprings.isExplodeEnabled, (on) => {
				this.layerSprings.isExplodeEnabled = on;
				this.saveSettings();
			}),
		);
		content.appendChild(
			this.toggleRow("Pause motion", this.layerSprings.isPaused, (on) => {
				this.layerSprings.isPaused = on;
				this.saveSettings();
			}),
		);
		content.appendChild(
			this.sliderRow("Motion", 0, 3, this.layerSprings.motionScale, (value) => {
				this.layerSprings.motionScale = value;
				this.saveSettings();
			}),
		);
		content.appendChild(
			this.sliderRow("Follow", 0, 2, this.layerSprings.followScale, (value) => {
				this.layerSprings.followScale = value;
				this.saveSettings();
			}),
		);
		return content;
	}

	/// A labeled checkbox row
	toggleRow(label, checked, onChange) {
		const row = document.createElement("label");
		row.setAttribute("class", "effectRow");
		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.checked = checked;
		checkbox.addEventListener("change", () => onChange(checkbox.checked));
		row.appendChild(checkbox);
		const text = document.createElement("span");
		text.innerText = label;
		row.appendChild(text);
		return row;
	}

	/// A labeled slider row
	sliderRow(label, min, max, value, onChange) {
		const row = document.createElement("label");
		row.setAttribute("class", "effectRow");
		const text = document.createElement("span");
		text.innerText = label;
		row.appendChild(text);
		const slider = document.createElement("input");
		slider.type = "range";
		slider.min = String(min);
		slider.max = String(max);
		slider.step = "0.05";
		slider.value = String(value);
		slider.addEventListener("input", () => onChange(Number(slider.value)));
		row.appendChild(slider);
		return row;
	}
}
