/// The Load Avastar section of the side panel: view any Avastar by
/// token id. Fully walletless - composition renders from the
/// static library, so this works identically logged out.
import { Strings } from "./Strings.js";

export default class LoadSection {
	/// - Parameters:
	///		- hasToken: async (tokenId) => corpus membership; checked
	///			BEFORE any load so bad ids show an inline error
	///			instead of starting a doomed load
	///		- onLoad: called with a validated token id
	constructor(hasToken, onLoad) {
		this.hasToken = hasToken;
		this.onLoad = onLoad;
	}

	/// Build the section body
	build() {
		const content = document.createElement("div");
		content.setAttribute("class", "loadControls");

		const note = document.createElement("div");
		note.setAttribute("class", "loadNote");
		note.innerText = Strings.load.note;
		content.appendChild(note);

		const row = document.createElement("div");
		row.setAttribute("class", "loadRow");
		this.input = document.createElement("input");
		this.input.setAttribute("id", "loadTokenInput");
		this.input.type = "text";
		this.input.inputMode = "numeric";
		this.input.placeholder = Strings.load.placeholder;
		this.input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				this.submit();
			}
		});
		row.appendChild(this.input);
		const button = document.createElement("div");
		button.setAttribute("class", "loadButton");
		button.innerText = Strings.load.button;
		button.addEventListener("click", () => this.submit());
		row.appendChild(button);
		content.appendChild(row);

		this.error = document.createElement("div");
		this.error.setAttribute("class", "loadError");
		content.appendChild(this.error);
		return content;
	}

	/// Validate the input and hand a known token id to the scene
	async submit() {
		// EVERY submission supersedes any pending membership check -
		// including invalid ones, which must cancel a slow in-flight
		// check rather than let it load a token the user moved past
		this.submitGeneration = (this.submitGeneration || 0) + 1;
		const generation = this.submitGeneration;
		const tokenId = this.input.value.trim();
		this.error.innerText = "";
		if (!/^\d+$/.test(tokenId)) {
			this.error.innerText = Strings.load.errorNotNumeric;
			return;
		}
		let isKnown = false;
		try {
			isKnown = await this.hasToken(tokenId);
		} catch (error) {
			if (generation !== this.submitGeneration) {
				return;
			}
			this.error.innerText = Strings.load.errorCheckFailed;
			return;
		}
		if (generation !== this.submitGeneration) {
			return;
		}
		if (!isKnown) {
			this.error.innerText = Strings.load.errorUnknown(tokenId);
			return;
		}
		this.onLoad(tokenId);
	}
}
