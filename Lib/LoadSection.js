/// The Load Avastar section of the side panel: view any Avastar by
/// token id. Fully walletless - composition renders from the
/// static library, so this works identically logged out.
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
		note.innerText =
			"View any of the 26,617 Avastars by token id — no wallet needed.";
		content.appendChild(note);

		const row = document.createElement("div");
		row.setAttribute("class", "loadRow");
		this.input = document.createElement("input");
		this.input.setAttribute("id", "loadTokenInput");
		this.input.type = "text";
		this.input.inputMode = "numeric";
		this.input.placeholder = "Token id";
		this.input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				this.submit();
			}
		});
		row.appendChild(this.input);
		const button = document.createElement("div");
		button.setAttribute("class", "loadButton");
		button.innerText = "Load";
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
		const tokenId = this.input.value.trim();
		this.error.innerText = "";
		if (!/^\d+$/.test(tokenId)) {
			this.error.innerText = "Enter a numeric token id";
			return;
		}
		// A slow membership check (first call loads the library) must
		// not act on behalf of a submission the user has superseded
		this.submitGeneration = (this.submitGeneration || 0) + 1;
		const generation = this.submitGeneration;
		let isKnown = false;
		try {
			isKnown = await this.hasToken(tokenId);
		} catch (error) {
			if (generation !== this.submitGeneration) {
				return;
			}
			this.error.innerText = "Could not check that token id — try again";
			return;
		}
		if (generation !== this.submitGeneration) {
			return;
		}
		if (!isKnown) {
			this.error.innerText = `No Avastar has token id ${tokenId}`;
			return;
		}
		this.onLoad(tokenId);
	}
}
