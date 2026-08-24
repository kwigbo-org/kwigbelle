/// The Effects section of the side panel: user controls for the
/// spring rig, persisted per browser in localStorage so a visitor's
/// preferred feel survives reloads. Wave/Trails/Tilt are the
/// operator-picked effects of docs/tads/burned-traits.md Decision
/// 10 (Poke is always on and has no control here).
export default class EffectsSection {
	static STORAGE_KEY = "kwigbelle.effects";

	/// - Parameters:
	///		- layerSprings: The rig the controls drive
	///		- callbacks: { onTiltChanged(enabled) } — the scene owns
	///			the deviceorientation wiring
	constructor(layerSprings, callbacks = {}) {
		this.layerSprings = layerSprings;
		this.callbacks = callbacks;
		this.trailsEnabled = false;
		this.tiltEnabled = false;
		// A legacy stored `explode` key from before its retirement
		// (docs/tads/burned-traits.md Decision 1) is simply ignored
		const stored = this.loadSettings();
		if (stored) {
			this.layerSprings.isPaused = !!stored.paused;
			this.layerSprings.isWaveEnabled = !!stored.wave;
			this.trailsEnabled = !!stored.trails;
			this.tiltEnabled = !!stored.tilt;
			// Clamp to the sliders' ranges so a stale or hand-edited
			// stored value can't run the rig outside what the
			// controls display
			if (Number.isFinite(stored.motion)) {
				this.layerSprings.motionScale = Math.max(0, Math.min(3, stored.motion));
			}
			if (Number.isFinite(stored.follow)) {
				this.layerSprings.followScale = Math.max(0, Math.min(2, stored.follow));
			}
		}
		if (this.tiltEnabled && this.callbacks.onTiltChanged) {
			// Restore tilt on load. On iOS the permission call needs a
			// user gesture, so a restored toggle can stay inert there
			// until the user re-toggles (TAD Decision 10) — the scene's
			// wiring handles that quietly.
			this.callbacks.onTiltChanged(true);
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
					paused: this.layerSprings.isPaused,
					motion: this.layerSprings.motionScale,
					follow: this.layerSprings.followScale,
					wave: this.layerSprings.isWaveEnabled,
					trails: this.trailsEnabled,
					tilt: this.tiltEnabled,
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
			this.toggleRow("Pause motion", this.layerSprings.isPaused, (on) => {
				this.layerSprings.isPaused = on;
				this.saveSettings();
			}),
		);
		content.appendChild(
			this.sliderRow("Motion", 0, 3, this.layerSprings.motionScale, (value) => {
				this.layerSprings.motionScale = value;
			}),
		);
		content.appendChild(
			this.sliderRow("Follow", 0, 2, this.layerSprings.followScale, (value) => {
				this.layerSprings.followScale = value;
			}),
		);
		content.appendChild(
			this.toggleRow("Wave", this.layerSprings.isWaveEnabled, (on) => {
				this.layerSprings.isWaveEnabled = on;
				this.saveSettings();
			}),
		);
		content.appendChild(
			this.toggleRow("Trails", this.trailsEnabled, (on) => {
				this.trailsEnabled = on;
				this.saveSettings();
			}),
		);
		content.appendChild(
			this.toggleRow("Tilt follow", this.tiltEnabled, (on) => {
				this.tiltEnabled = on;
				if (this.callbacks.onTiltChanged) {
					// The toggle tap is also the user gesture iOS
					// requires for the motion permission prompt
					this.callbacks.onTiltChanged(on);
				}
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
		// input drives the rig live while dragging; the localStorage
		// write happens once on release (change), not per input event
		slider.addEventListener("input", () => onChange(Number(slider.value)));
		slider.addEventListener("change", () => this.saveSettings());
		row.appendChild(slider);
		return row;
	}
}
