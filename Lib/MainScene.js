import Scene from "./Scene.js";
import Size from "./Size.js";
import Point from "./Point.js";
import AvastarParser from "./AvastarParser.js";
import AvastarLoader from "./AvastarLoader.js";
import TraitComposer from "./TraitComposer.js";

/// Class used to represent the Avastars scene
export default class MainScene extends Scene {
	/// Overridden constructor
	constructor(rootContainer) {
		super(rootContainer);
		console.log("kwigbelle build 2026-08-21.7 (trait composition flag)");
		// Build the UI
		this.buildUI();
		// Start loading
		this.isLoading = true;
		// Check url params for a "tokenId"
		const urlParams = new URLSearchParams(
			window.location.search.toLowerCase()
		);
		this.isParserDebugEnabled = urlParams.get("parserdebug");
		this.isExplodeEnabled = urlParams.get("explode");
		// TAD Step 4 rollout flag: ?traitcompose=1 composes layers
		// from the committed trait library instead of slicing the
		// on-chain render (docs/tads/trait-composition.md)
		this.isTraitComposeEnabled = urlParams.get("traitcompose") === "1";
		this.traitComposer = new TraitComposer();
		// Object used to load the Avastar SVG from on chain
		this.avastarLoader = new AvastarLoader(null);
		this.initialLoad(urlParams.get("tokenid"));
	}

	/// Pick and load the first Avastar to display. A tokenid url
	/// param wins; otherwise a random bundled kwigbelle Avastar
	/// shows instantly while the wallet is asked for its Avastars
	/// in the background - on chain calls can take a while - and
	/// the display swaps to the wallet's first Avastar when ready.
	///
	/// - Parameter tokenParam: The tokenid url param, if any
	async initialLoad(tokenParam) {
		const hasWallet = await this.avastarLoader.hasWallet();
		if (tokenParam && (hasWallet || this.isTraitComposeEnabled)) {
			// Fallback must stay valid without a wallet: loadToken
			// needs one, so walletless composition failures degrade
			// to a bundled Avastar instead of a dead preloader
			const fallback = hasWallet
				? (complete) =>
						this.avastarLoader.loadToken(tokenParam, complete)
				: (complete) => {
						const avastars = [8014, 25495, 25470, 25505, 21022];
						this.avastarLoader.tokenId =
							avastars[
								Math.floor(Math.random() * avastars.length)
							];
						this.avastarLoader.loadLocalAvastarSVG(complete);
					};
			this.beginLoad(fallback, tokenParam);
		} else {
			// Instant display from the bundled SVGs
			const avastars = [8014, 25495, 25470, 25505, 21022];
			this.avastarLoader.tokenId =
				avastars[Math.floor(Math.random() * avastars.length)];
			this.beginLoad(
				(complete) => this.avastarLoader.loadLocalAvastarSVG(complete),
				this.avastarLoader.tokenId
			);
		}
		if (!hasWallet) {
			return;
		}
		// Never prompt on page load: only a silent account check.
		// The Link Wallet button below handles first time connects.
		let ownedTokenIds = [];
		try {
			ownedTokenIds = await this.avastarLoader.getOwnedTokenIds(false);
		} catch (error) {
			console.error("Could not list the wallet's Avastars", error);
		}
		if (ownedTokenIds.length > 0) {
			this.buildAvastarPicker(ownedTokenIds);
			if (!tokenParam) {
				// Swap silently: keep the current Avastar animating
				// until the wallet's first one has rendered
				this.selectAvastar(ownedTokenIds[0], true);
			}
			return;
		}
		// The wallet needs help from the user: either it is on the
		// wrong network for this site, or it has not authorized the
		// site yet. Offer a button for whichever fix applies.
		const onMainnet = await this.avastarLoader.isMainnet();
		if (!onMainnet) {
			this.buildConnectButton("🔗 Switch to Mainnet");
			return;
		}
		const accounts = await this.avastarLoader.provider
			.request({ method: "eth_accounts" })
			.catch(() => []);
		if (!accounts || accounts.length === 0) {
			this.buildConnectButton("🔗 Link Wallet");
		}
	}

	/// Build the upper left wallet button shown when the wallet
	/// needs a user tap: to authorize the site or fix the network
	///
	/// - Parameter title: The label to show on the button
	buildConnectButton(title) {
		if (this.connectContainer) {
			return;
		}
		this.connectContainer = document.createElement("div");
		this.connectContainer.setAttribute("id", "avastarPicker");
		this.stopSceneEvents(this.connectContainer);
		const button = document.createElement("div");
		button.setAttribute("class", "connectButton");
		button.innerText = title;
		button.addEventListener("click", this.connectWallet.bind(this));
		this.connectContainer.appendChild(button);
		this.rootContainer.appendChild(this.connectContainer);
	}

	/// Entry point for the wallet button: with several wallets
	/// installed show a chooser first, otherwise connect directly
	async connectWallet() {
		const wallets = await this.avastarLoader.getWallets();
		if (wallets.length > 1) {
			this.toggleWalletChooser(wallets);
			return;
		}
		this.continueConnect();
	}

	/// Expand or collapse the list of installed wallets under the
	/// wallet button. Picking one remembers it for future visits.
	///
	/// - Parameter wallets: The { info, provider } entries to list
	toggleWalletChooser(wallets) {
		if (this.walletList) {
			this.walletList.remove();
			this.walletList = null;
			return;
		}
		this.walletList = document.createElement("div");
		this.walletList.setAttribute("id", "walletList");
		for (const wallet of wallets) {
			const row = document.createElement("div");
			row.setAttribute("class", "walletRow");
			if (wallet.info && wallet.info.icon) {
				const icon = document.createElement("img");
				icon.src = wallet.info.icon;
				row.appendChild(icon);
			}
			const name = document.createElement("span");
			name.innerText = (wallet.info && wallet.info.name) || "Wallet";
			row.appendChild(name);
			row.addEventListener(
				"click",
				function () {
					this.avastarLoader.selectWallet(wallet);
					this.walletList.remove();
					this.walletList = null;
					this.continueConnect();
				}.bind(this)
			);
			this.walletList.appendChild(row);
		}
		this.connectContainer.appendChild(this.walletList);
	}

	/// Fix whatever the chosen wallet needs (from a user tap, which
	/// every wallet allows): switch to mainnet and/or connect, then
	/// swap in the picker
	async continueConnect() {
		// Reentrancy guard: a second tap while the flow is mid
		// flight would run two connects and build two pickers
		if (this.isConnecting) {
			return;
		}
		this.isConnecting = true;
		try {
			// Wrong network: ask the wallet to switch. The page
			// reloads into the working state via the chainChanged
			// listener.
			const onMainnet = await this.avastarLoader.isMainnet();
			if (!onMainnet) {
				const switched = await this.avastarLoader.switchToMainnet();
				if (switched) {
					// Fallback for wallets that do not emit chainChanged
					window.location.reload();
				}
				return;
			}
			let ownedTokenIds = [];
			try {
				ownedTokenIds = await this.avastarLoader.getOwnedTokenIds(
					true
				);
			} catch (error) {
				console.error("Wallet connect failed", error);
				return;
			}
			if (ownedTokenIds.length === 0) {
				return;
			}
			this.connectContainer.remove();
			this.connectContainer = null;
			this.buildAvastarPicker(ownedTokenIds);
			this.selectAvastar(ownedTokenIds[0], false);
		} finally {
			this.isConnecting = false;
		}
	}

	/// Keep taps on an overlay element from reaching the Scene's
	/// window level touch handlers, which would fling the layers
	///
	/// - Parameter element: The element to isolate
	stopSceneEvents(element) {
		// Release events (mouseup/touchend) deliberately propagate:
		// they only clear the scene's touch state, and swallowing
		// them would leave isTouchDown stuck when a drag that began
		// on the canvas releases over this element
		const eventNames = [
			"mousedown",
			"mousemove",
			"touchstart",
			"touchmove",
		];
		for (const eventName of eventNames) {
			element.addEventListener(eventName, (event) =>
				event.stopPropagation()
			);
		}
	}

	/// Start a load through the given function, ignoring stale
	/// completions: an older load finishing after a newer one
	/// started must not overwrite the newer Avastar. When trait
	/// composition is enabled (and a tokenId is known) the library
	/// path is tried first; the legacy loader+parser path is the
	/// fallback on any composition failure.
	///
	/// - Parameters:
	///		- loadFunction: Called with the completion handler
	///		- tokenId: The token being loaded (enables composition)
	beginLoad(loadFunction, tokenId) {
		this.loadGeneration = (this.loadGeneration || 0) + 1;
		const generation = this.loadGeneration;
		const complete = function () {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.parseAvastarSVG();
			this.finishLoad(generation);
		}.bind(this);
		if (this.isTraitComposeEnabled && tokenId != null) {
			this.traitComposer
				.compose(
					tokenId,
					new Size(this.canvas.width, this.canvas.height)
				)
				.then((composed) => {
					if (generation !== this.loadGeneration) {
						return;
					}
					// Keep the loader's state coherent: thumbnails
					// and the same-token guard read from it
					this.avastarLoader.tokenId = tokenId;
					this.avastarLoader.currentAvastar = composed.fullSVG;
					this.avastar = composed;
					this.setupLayerSprings();
					this.finishLoad(generation);
				})
				.catch((error) => {
					console.warn(
						`trait composition failed for ${tokenId}, using legacy path`,
						error
					);
					loadFunction(complete);
				});
			return;
		}
		loadFunction(complete);
	}

	/// Shared tail of every successful (or recovered) load
	finishLoad(generation) {
		if (generation !== this.loadGeneration) {
			return;
		}
		const contentView = document.getElementById("contentView");
		if (this.avastar && this.avastar.backgroundColor) {
			contentView.style.backgroundColor = this.avastar.backgroundColor;
		}
		this.isLoading = false;
		this.preloader.style.opacity = 0;
		this.updateSelectedThumbnail();
	}

	// MARK: Overridden Methods

	resize() {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		if (this.isTraitComposeEnabled && this.avastar && this.avastar.layerInfo) {
			// Composed path: rebuild layer images at the new size
			// (fragments are cached in the composer, no refetch).
			// Bump the generation so any older in-flight compose -
			// sized for the previous canvas - is discarded.
			this.loadGeneration = (this.loadGeneration || 0) + 1;
			const generation = this.loadGeneration;
			this.traitComposer
				.compose(
					this.avastarLoader.tokenId,
					new Size(this.canvas.width, this.canvas.height)
				)
				.then((composed) => {
					if (generation !== this.loadGeneration) return;
					this.avastar = composed;
					this.setupLayerSprings();
				})
				.catch((error) => console.warn("recompose failed", error));
			return;
		}
		/// Reparse
		this.parseAvastarSVG();
	}

	render() {
		const context = this.canvas.getContext("2d");
		context.clearRect(0, 0, this.canvas.width, this.canvas.height);
		// The avastar guard covers failed loads: isLoading clears on
		// completion even when no Avastar could be parsed
		if (this.isLoading || !this.avastar) {
			return;
		}

		// Time step for the physics, clamped so a background tab
		// doesn't launch the layers on the first frame back
		const now = performance.now() / 1000;
		let dt = now - (this.lastFrameTime || now);
		this.lastFrameTime = now;
		dt = Math.min(dt, 1 / 30);

		context.drawImage(
			this.avastar.backgroundLayer,
			0,
			0,
			this.canvas.width,
			this.canvas.height
		);

		const centerPoint = new Point(
			this.canvas.width / 2,
			this.canvas.height / 2
		);
		for (let index = 0; index < this.avastar.layers.length; index++) {
			const layer = this.avastar.layers[index];
			const spring = this.layerSprings[index];

			// Resting target is the center, drifting on slow sine
			// waves so the Avastar "breathes" while idle
			let targetX =
				centerPoint.x +
				Math.sin(now * 0.6 + spring.phase) * spring.swayAmp;
			let targetY =
				centerPoint.y +
				Math.sin(now * 0.9 + spring.phase) * spring.breatheAmp;
			if (this.isTouchDown) {
				// Front layers overshoot toward the pointer more than
				// back layers, separating them for a parallax feel
				targetX =
					centerPoint.x +
					(this.touchPoint.x - centerPoint.x) * spring.reach;
				targetY =
					centerPoint.y +
					(this.touchPoint.y - centerPoint.y) * spring.reach;
			}

			// Underdamped spring integration so layers overshoot
			// and settle instead of moving linearly
			const ax =
				(targetX - spring.x) * spring.stiffness -
				spring.vx * spring.damping;
			const ay =
				(targetY - spring.y) * spring.stiffness -
				spring.vy * spring.damping;
			spring.vx += ax * dt;
			spring.vy += ay * dt;
			spring.x += spring.vx * dt;
			spring.y += spring.vy * dt;

			context.drawImage(
				layer,
				spring.x - this.canvas.width / 2,
				spring.y - this.canvas.height / 2
			);
		}
	}

	// "Private Methods"

	/// Method to build the UI needed for this scene
	buildUI() {
		// Main canvas
		this.canvas = document.createElement("canvas");
		this.canvas.setAttribute("id", "mainCanvas");
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		this.rootContainer.appendChild(this.canvas);
		this.displayLoop.start(60);

		// Preloader Container
		this.preloader = document.createElement("div");
		this.preloader.setAttribute("id", "preloader");
		this.preloader.setAttribute("class", "centeredContainer");

		// Spinner
		const spinner = document.createElement("div");
		spinner.setAttribute("class", "lds-circle");
		const innerDiv = document.createElement("div");
		spinner.appendChild(innerDiv);
		this.preloader.appendChild(spinner);

		this.rootContainer.appendChild(this.preloader);
	}

	/// Create an img element for an SVG string. The backing blob
	/// URL is revoked once the image has loaded, so thumbnails do
	/// not leak object URLs across Avastar swaps.
	///
	/// - Parameter svgString: The SVG string to convert
	svgToImage(svgString) {
		const blob = new Blob([svgString], { type: "image/svg+xml" });
		const url = URL.createObjectURL(blob);
		const image = document.createElement("img");
		image.src = url;
		// Revoke on error too: a malformed SVG fires error instead
		// of load and would otherwise leak the URL
		const revoke = () => URL.revokeObjectURL(url);
		image.addEventListener("load", revoke, { once: true });
		image.addEventListener("error", revoke, { once: true });
		return image;
	}

	/// Build the upper left thumbnail that expands into a picker
	/// listing every Avastar the connected wallet owns
	///
	/// - Parameter tokenIds: The owned token ids to list
	buildAvastarPicker(tokenIds) {
		this.ownedTokenIds = tokenIds;
		this.thumbnailCache = {};

		this.picker = document.createElement("div");
		this.picker.setAttribute("id", "avastarPicker");
		this.stopSceneEvents(this.picker);

		// The always visible thumbnail showing the current Avastar
		this.selectedThumbnail = document.createElement("div");
		this.selectedThumbnail.setAttribute("class", "pickerThumb current");
		this.selectedThumbnail.addEventListener(
			"click",
			function () {
				this.togglePicker();
			}.bind(this)
		);
		this.picker.appendChild(this.selectedThumbnail);

		// The expandable list of owned Avastars
		this.pickerList = document.createElement("div");
		this.pickerList.setAttribute("id", "pickerList");
		for (const tokenId of tokenIds) {
			const item = document.createElement("div");
			item.setAttribute("class", "pickerThumb");
			const label = document.createElement("span");
			label.innerText = tokenId;
			item.appendChild(label);
			item.addEventListener(
				"click",
				function () {
					this.selectAvastar(tokenId);
				}.bind(this)
			);
			this.pickerItems = this.pickerItems || {};
			this.pickerItems[tokenId] = item;
			this.pickerList.appendChild(item);
		}
		this.picker.appendChild(this.pickerList);
		this.rootContainer.appendChild(this.picker);
		// The first load may have completed before the picker
		// existed, so backfill the thumbnail
		this.updateSelectedThumbnail();
	}

	/// Expand or collapse the picker list. Thumbnails render
	/// lazily on first expand and are cached after that.
	togglePicker() {
		const isExpanded = this.pickerList.classList.toggle("expanded");
		if (isExpanded) {
			this.loadPickerThumbnails();
		}
	}

	/// Render each owned Avastar into its picker thumbnail,
	/// one at a time to keep the wallet RPC happy
	async loadPickerThumbnails() {
		if (this.isLoadingThumbnails) {
			return;
		}
		this.isLoadingThumbnails = true;
		for (const tokenId of this.ownedTokenIds) {
			if (this.thumbnailCache[tokenId]) {
				continue;
			}
			try {
				const svgString = await this.avastarLoader.renderTokenSVG(
					tokenId
				);
				this.thumbnailCache[tokenId] = true;
				const item = this.pickerItems[tokenId];
				item.innerHTML = "";
				item.appendChild(this.svgToImage(svgString));
			} catch (error) {
				// Leave the token id label as the fallback thumbnail
			}
		}
		this.isLoadingThumbnails = false;
	}

	/// Load a picked Avastar and collapse the picker. The current
	/// Avastar keeps animating while the new one loads.
	///
	/// - Parameters:
	///		- tokenId: The token id to load
	///		- isSilent: When true no preloader is shown (used for
	///			the automatic swap to the wallet's first Avastar)
	selectAvastar(tokenId, isSilent) {
		this.pickerList.classList.remove("expanded");
		if (String(tokenId) === String(this.avastarLoader.tokenId)) {
			return;
		}
		if (!isSilent) {
			this.preloader.style.opacity = 1;
		}
		this.beginLoad(
			(complete) => this.avastarLoader.loadToken(tokenId, complete),
			tokenId
		);
	}

	/// Show the currently loaded Avastar in the collapsed thumbnail
	updateSelectedThumbnail() {
		if (!this.selectedThumbnail || !this.avastarLoader.currentAvastar) {
			return;
		}
		this.selectedThumbnail.innerHTML = "";
		this.selectedThumbnail.appendChild(
			this.svgToImage(this.avastarLoader.currentAvastar)
		);
	}

	/// Method used to trigger the parse of the currently loaded avastar.
	parseAvastarSVG() {
		// Check the avastar loader for an Avastar
		const svgString = this.avastarLoader.currentAvastar;
		if (!svgString) {
			// TODO: Handle this failure
			return;
		}
		// Create a new AvastarParser and pass in the currently loaded Avastar
		this.avastar = new AvastarParser(
			svgString,
			new Size(this.canvas.width, this.canvas.height)
		);
		this.avastar.debug = this.isParserDebugEnabled;
		// Parse the Avastar SVG
		this.avastar.parse();

		const contentView = document.getElementById("contentView");
		// Get the background color from the Avastar Parser
		contentView.style.backgroundColor = this.avastar.backgroundColor;
		this.setupLayerSprings();
	}

	/// Setup a spring for each layer so each moves independently.
	/// Layer 0 is the deepest, the last layer is in front: front
	/// layers get looser springs, larger breathing motion, and more
	/// reach toward the pointer. Shared by the parser and trait
	/// composition paths.
	setupLayerSprings() {
		this.layerSprings = [];
		const layerCount = this.avastar.layers.length;
		for (let index = 0; index < layerCount; index++) {
			// Normalized depth 0 (back) to 1 (front): avastars can
			// slice into very different layer counts depending on
			// their traits, and raw index scaling made many layered
			// ones fly apart
			const depth = layerCount > 1 ? index / (layerCount - 1) : 0;
			const stiffness = 90 - depth * 55;
			const explodeScale = this.isExplodeEnabled ? 4 : 1;
			this.layerSprings.push({
				x: this.canvas.width / 2,
				y: this.canvas.height / 2,
				vx: 0,
				vy: 0,
				stiffness: stiffness,
				damping: 2 * Math.sqrt(stiffness) * 0.45,
				reach: 1 + depth * 0.35 * explodeScale,
				phase: depth * 2.4,
				swayAmp: 1 + depth * 3.5,
				breatheAmp: 2 + depth * 6.5,
			});
		}
	}
}
