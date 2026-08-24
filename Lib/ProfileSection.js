import { svgToImage } from "./UIHelpers.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/// The profile drawer content (docs/tads/profile-drawer.md): the
/// wallet connect flow — moved wholesale from the retired
/// WalletConnectUI — plus the owned-Avastars grid that replaced the
/// floating picker. The scene stays the load orchestrator: picks
/// and connects come back through the callbacks.
export default class ProfileSection {
	/// - Parameters:
	///		- avastarLoader: The wallet integration to drive
	///		- callbacks: { onConnected(ownedTokenIds),
	///			onPick(tokenId), isDrawerOpen() }
	constructor(avastarLoader, callbacks) {
		this.avastarLoader = avastarLoader;
		this.callbacks = callbacks;
		this.walletState = null;
	}

	/// The profile tab's face: a person glyph as inline SVG so it
	/// obeys the chrome's CSS colors (platform emoji would not)
	static handleIcon() {
		const svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("class", "profileHandleIcon");
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute(
			"d",
			"M12 12.3c2.8 0 5-2.3 5-5.1S14.8 2 12 2 7 4.3 7 7.2s2.2 5.1 5 5.1z" +
				"m0 2.6c-3.3 0-10 1.7-10 5v2.1h20v-2.1c0-3.3-6.7-5-10-5z",
		);
		path.setAttribute("fill", "currentColor");
		svg.appendChild(path);
		return svg;
	}

	/// Build the drawer content: the wallet-state area on top, the
	/// owned grid below
	build() {
		this.container = document.createElement("div");
		this.container.setAttribute("id", "profileContent");
		this.status = document.createElement("div");
		this.status.setAttribute("id", "profileStatus");
		this.container.appendChild(this.status);
		this.grid = document.createElement("div");
		this.grid.setAttribute("id", "profileGrid");
		this.container.appendChild(this.grid);
		return this.container;
	}

	/// Rebuild the wallet-state area. Every state has a visible home
	/// in the drawer: a note without a wallet, the fix button when
	/// the wallet needs a user tap, the address once connected.
	///
	/// - Parameter state: "none" | "disconnected" | "wrongNetwork"
	///		| "connected"
	setWalletState(state) {
		this.walletState = state;
		this.status.innerHTML = "";
		this.walletList = null;
		if (state === "none") {
			const note = document.createElement("div");
			note.setAttribute("class", "profileNote");
			note.innerText =
				"No Ethereum wallet detected. Install one to see your own " +
				"Avastars here.";
			this.status.appendChild(note);
			return;
		}
		if (state === "connected") {
			const address = document.createElement("div");
			address.setAttribute("id", "profileAddress");
			address.innerText = "Connected";
			this.status.appendChild(address);
			this.fillAddress(address);
			return;
		}
		const button = document.createElement("div");
		button.setAttribute("class", "connectButton");
		button.innerText =
			state === "wrongNetwork" ? "🔗 Switch to Mainnet" : "🔗 Link Wallet";
		button.addEventListener("click", this.connectWallet.bind(this));
		this.status.appendChild(button);
	}

	/// Best-effort short address; the plain "Connected" label stands
	/// if the provider declines or the state moved on
	async fillAddress(element) {
		if (!this.avastarLoader.provider) {
			return;
		}
		try {
			const accounts = await this.avastarLoader.provider.request({
				method: "eth_accounts",
			});
			if (accounts && accounts.length > 0 && element.isConnected) {
				element.innerText =
					accounts[0].slice(0, 6) + "…" + accounts[0].slice(-4);
			}
		} catch (error) {
			// Keep the plain label
		}
	}

	/// Build the owned-Avastars grid
	///
	/// - Parameter tokenIds: The owned token ids to list
	buildGrid(tokenIds) {
		// A thumbnail loop from a previous build must neither block
		// this session's loads nor write into its cache/DOM: bump
		// the generation (stale loops check it and die) and clear
		// the in-flight flag alongside the other state (the same
		// guards the retired picker carried)
		this.buildGeneration = (this.buildGeneration || 0) + 1;
		this.isLoadingThumbnails = false;
		this.ownedTokenIds = tokenIds;
		this.thumbnailCache = {};
		this.gridItems = {};
		this.grid.innerHTML = "";
		if (tokenIds.length === 0) {
			const note = document.createElement("div");
			note.setAttribute("class", "profileNote");
			note.innerText = "No Avastars in this wallet.";
			this.grid.appendChild(note);
			return;
		}
		for (const tokenId of tokenIds) {
			const item = document.createElement("div");
			item.setAttribute("class", "profileTile");
			// The tile keeps naming its token after the id label is
			// replaced by a thumbnail
			item.setAttribute("data-token", String(tokenId));
			const label = document.createElement("span");
			label.innerText = tokenId;
			item.appendChild(label);
			item.addEventListener("click", () => this.callbacks.onPick(tokenId));
			this.gridItems[tokenId] = item;
			this.grid.appendChild(item);
		}
		this.setCurrent(this.currentTokenId);
		// The grid can be (re)built while the drawer is already
		// showing — the connect flow ends here — so the open hook
		// alone would leave these tiles as bare labels
		if (this.callbacks.isDrawerOpen && this.callbacks.isDrawerOpen()) {
			this.loadThumbnails();
		}
	}

	/// Highlight the tile of the currently displayed token
	setCurrent(tokenId) {
		this.currentTokenId = tokenId != null ? String(tokenId) : null;
		if (!this.gridItems) {
			return;
		}
		for (const [id, item] of Object.entries(this.gridItems)) {
			item.classList.toggle("current", id === this.currentTokenId);
		}
	}

	/// Drawer-open hook: thumbnails render lazily on first open and
	/// are cached after that
	onOpen() {
		if (this.ownedTokenIds && this.ownedTokenIds.length > 0) {
			this.loadThumbnails();
		}
	}

	/// Render each owned Avastar into its grid tile, one at a time
	/// to keep the wallet RPC happy
	async loadThumbnails() {
		if (this.isLoadingThumbnails) {
			return;
		}
		this.isLoadingThumbnails = true;
		const generation = this.buildGeneration;
		for (const tokenId of this.ownedTokenIds) {
			if (this.thumbnailCache[tokenId]) {
				continue;
			}
			try {
				const svgString = await this.avastarLoader.renderTokenSVG(tokenId);
				// The grid may have been rebuilt while the render was
				// in flight: a stale loop must not touch the new
				// session's cache, items, or in-flight flag
				if (generation !== this.buildGeneration) {
					return;
				}
				this.thumbnailCache[tokenId] = true;
				const item = this.gridItems[tokenId];
				item.innerHTML = "";
				item.appendChild(svgToImage(svgString));
			} catch (error) {
				// Leave the token id label as the fallback thumbnail
				if (generation !== this.buildGeneration) {
					return;
				}
			}
		}
		if (generation === this.buildGeneration) {
			this.isLoadingThumbnails = false;
		}
	}

	/// Entry point for the connect button: with several wallets
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
	/// connect button. Picking one remembers it for future visits.
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
				}.bind(this),
			);
			this.walletList.appendChild(row);
		}
		this.status.appendChild(this.walletList);
	}

	/// Fix whatever the chosen wallet needs (from a user tap, which
	/// every wallet allows): switch to mainnet and/or connect, then
	/// hand the owned Avastars to the scene
	async continueConnect() {
		// Reentrancy guard: a second tap while the flow is mid
		// flight would run two connects and build two grids
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
				ownedTokenIds = await this.avastarLoader.getOwnedTokenIds(true);
			} catch (error) {
				console.error("Wallet connect failed", error);
				return;
			}
			this.setWalletState("connected");
			this.callbacks.onConnected(ownedTokenIds);
		} finally {
			this.isConnecting = false;
		}
	}
}
