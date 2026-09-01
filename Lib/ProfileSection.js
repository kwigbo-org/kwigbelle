import { Strings } from "./Strings.js";
import { svgToImage } from "./UIHelpers.js";
import {
	rarityIcon,
	tierForScore,
	kindLabel,
	genderLabel,
	flameIcon,
} from "./RarityIcons.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/// The profile drawer content (docs/tads/profile-drawer.md): the
/// wallet connect flow — moved wholesale from the retired
/// WalletConnectUI — plus the owned-Avastars grid that replaced the
/// floating picker. The scene stays the load orchestrator: picks
/// and connects come back through the callbacks.
export default class ProfileSection {
	/// - Parameters:
	///		- avastarLoader: The wallet integration to drive
	///		- traitComposer: Source of the composed thumbnails
	///		- callbacks: { onConnected(ownedTokenIds),
	///			onPick(tokenId), onLoggedOut(), isDrawerOpen() }
	constructor(avastarLoader, traitComposer, callbacks) {
		this.avastarLoader = avastarLoader;
		this.traitComposer = traitComposer;
		this.callbacks = callbacks;
		this.walletState = null;
	}

	/// The profile tab's face: a person glyph as inline SVG so it
	/// obeys the chrome's CSS colors (platform emoji would not)
	static handleIcon() {
		return ProfileSection.icon(
			"M12 12.3c2.8 0 5-2.3 5-5.1S14.8 2 12 2 7 4.3 7 7.2s2.2 5.1 5 5.1z" +
				"m0 2.6c-3.3 0-10 1.7-10 5v2.1h20v-2.1c0-3.3-6.7-5-10-5z",
			"handleIcon",
		);
	}

	/// The logout button's door-with-arrow glyph
	static logoutIcon() {
		return ProfileSection.icon(
			"M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3" +
				"H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z",
			"logoutIcon",
		);
	}

	/// A currentColor inline SVG from a 24x24 path
	static icon(pathData, className) {
		const svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("class", className);
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute("d", pathData);
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
		this.filterInput = document.createElement("input");
		this.filterInput.setAttribute("class", "cardFilter");
		this.filterInput.setAttribute("type", "text");
		this.filterInput.setAttribute("placeholder", Strings.cards.filter);
		this.filterInput.style.display = "none";
		this.filterInput.addEventListener("input", () => this.applyFilter());
		this.container.appendChild(this.filterInput);
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
			note.innerText = Strings.profile.noWallet;
			this.status.appendChild(note);
			return;
		}
		if (state === "connected") {
			// Address on the left, log out on the right
			const row = document.createElement("div");
			row.setAttribute("id", "profileConnectedRow");
			const address = document.createElement("div");
			address.setAttribute("id", "profileAddress");
			address.innerText = Strings.profile.connected;
			row.appendChild(address);
			const logout = document.createElement("div");
			logout.setAttribute("class", "profileLogout");
			logout.setAttribute("title", Strings.profile.logout);
			logout.appendChild(ProfileSection.logoutIcon());
			logout.addEventListener("click", () => this.logout());
			row.appendChild(logout);
			this.status.appendChild(row);
			this.fillAddress(address);
			return;
		}
		const button = document.createElement("div");
		button.setAttribute("class", "connectButton");
		button.innerText =
			state === "wrongNetwork"
				? Strings.profile.switchNetwork
				: Strings.profile.linkWallet;
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

	/// Build the owned-Avastars grid as trading cards
	/// (docs/tads/wallet-cards.md): tap-to-load stats front, ⓘ
	/// flips to a details back
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
		this.backBuilt = {};
		this.flippedTokenId = null;
		this.searchText = {};
		this.filterInput.value = "";
		this.filterInput.style.display = tokenIds.length > 0 ? "" : "none";
		this.grid.innerHTML = "";
		if (tokenIds.length === 0) {
			const note = document.createElement("div");
			note.setAttribute("class", "profileNote");
			note.innerText = Strings.profile.emptyWallet;
			this.grid.appendChild(note);
			return;
		}
		for (const tokenId of tokenIds) {
			const card = document.createElement("div");
			card.setAttribute("class", "profileCard");
			// The card keeps naming its token after the id label is
			// replaced by a thumbnail
			card.setAttribute("data-token", String(tokenId));
			const inner = document.createElement("div");
			inner.setAttribute("class", "cardInner");
			inner.appendChild(this.cardFront(tokenId));
			const back = document.createElement("div");
			back.setAttribute("class", "cardBack");
			// The title/✕ row exists from birth so a failed details
			// build never strands a flipped card without a way home
			const top = document.createElement("div");
			top.setAttribute("class", "cardBackTop");
			const title = document.createElement("div");
			title.setAttribute("class", "cardBackTitle");
			title.innerText = Strings.traits.identityTitle(tokenId);
			top.appendChild(title);
			top.appendChild(this.flipButton(tokenId, "✕"));
			back.appendChild(top);
			inner.appendChild(back);
			card.appendChild(inner);
			this.gridItems[tokenId] = card;
			this.grid.appendChild(card);
			this.fillCardStats(tokenId, card);
		}
		this.setCurrent(this.currentTokenId);
		// The grid can be (re)built while the drawer is already
		// showing — the connect flow ends here — so the open hook
		// alone would leave these tiles as bare labels
		if (this.callbacks.isDrawerOpen && this.callbacks.isDrawerOpen()) {
			this.loadThumbnails();
		}
	}

	/// A card's front face: the composed art, the stat strip, and
	/// the ⓘ flip affordance floating over the art corner. The
	/// whole front is the tap-to-load surface (operator QA).
	cardFront(tokenId) {
		const front = document.createElement("div");
		front.setAttribute("class", "cardFront");
		front.addEventListener("click", () => {
			// A flipped card's front is rotated away; never load from
			// a click that reached it anyway
			if (this.flippedTokenId === String(tokenId)) {
				return;
			}
			this.callbacks.onPick(tokenId);
		});
		const art = document.createElement("div");
		art.setAttribute("class", "cardArt");
		const label = document.createElement("span");
		label.innerText = tokenId;
		art.appendChild(label);
		front.appendChild(art);
		const stats = document.createElement("div");
		stats.setAttribute("class", "cardStats");
		const id = document.createElement("div");
		id.setAttribute("class", "cardId");
		id.innerText = "#" + tokenId;
		stats.appendChild(id);
		// Special kinds get their own louder line (operator QA);
		// primes stay quiet - their series tag lives in the strip.
		// Filled async by fillCardStats from the local corpus.
		const kind = document.createElement("div");
		kind.setAttribute("class", "cardKind");
		stats.appendChild(kind);
		const statLine = document.createElement("div");
		statLine.setAttribute("class", "cardStatLine");
		stats.appendChild(statLine);
		front.appendChild(stats);
		// The ⓘ floats over the art corner - the whole front is the
		// tap-to-load surface (operator QA: no Load button)
		front.appendChild(this.flipButton(tokenId, "ⓘ"));
		return front;
	}

	/// The flip affordance: ⓘ on the front, ✕ on the back. Pure
	/// glyphs (iconography, not prose); the tooltip is editorial.
	flipButton(tokenId, glyph) {
		const flip = document.createElement("div");
		flip.setAttribute("class", "cardFlip");
		flip.setAttribute("title", Strings.cards.details);
		flip.innerText = glyph;
		flip.addEventListener("click", (event) => {
			event.stopPropagation();
			this.flipCard(tokenId);
		});
		return flip;
	}

	/// Fill a card front's tier frame and stat strip from the local
	/// corpus (zero chain calls). A rebuild mid-lookup must not
	/// stamp a stale card.
	async fillCardStats(tokenId, card) {
		const generation = this.buildGeneration;
		let info = null;
		try {
			info = await this.traitComposer.tokenInfo(tokenId);
		} catch (error) {
			return;
		}
		if (!info || generation !== this.buildGeneration || !card.isConnected) {
			return;
		}
		const tier = tierForScore(info.ranking);
		// The faces read the frame color from this custom property
		card.style.setProperty("--cardTier", tier.color);
		const label = kindLabel(tokenId, info.kind);
		if (label !== "Prime") {
			card.querySelector(".cardKind").innerText = label;
		}
		const statLine = card.querySelector(".cardStatLine");
		statLine.appendChild(rarityIcon(tier.rarity));
		const text = document.createElement("span");
		const parts = [String(info.ranking), genderLabel(info.gender)];
		if (info.series !== null && info.series !== undefined) {
			parts.push(Strings.cards.series(info.series));
		}
		text.innerText = parts.join(" · ");
		statLine.appendChild(text);
	}

	/// Filter the cards by free text (operator QA 2026-09-01):
	/// matches token id, kind, gender, tier, series tag, and every
	/// trait name. The haystack builds lazily per token from the
	/// local corpus and is cached until the next grid build.
	async applyFilter() {
		const query = this.filterInput.value.trim().toLowerCase();
		const generation = this.buildGeneration;
		// Rapid typing overlaps async calls (the first uncached pass
		// awaits per token): only the NEWEST invocation may write
		// visibility, or a stale query's results land last (review
		// catch, all four panels)
		this.filterSeq = (this.filterSeq || 0) + 1;
		const seq = this.filterSeq;
		for (const tokenId of this.ownedTokenIds) {
			let match = query === "";
			if (!match) {
				if (this.searchText[tokenId] === undefined) {
					this.searchText[tokenId] = await this.buildSearchText(tokenId);
					if (generation !== this.buildGeneration || seq !== this.filterSeq) {
						return;
					}
				}
				match = this.searchText[tokenId].includes(query);
			}
			const card = this.gridItems[tokenId];
			if (card) {
				card.style.display = match ? "" : "none";
			}
		}
	}

	/// The searchable text for one token - all local, no fetches
	/// beyond the already-cached corpus tables
	async buildSearchText(tokenId) {
		const parts = ["#" + tokenId, String(tokenId)];
		try {
			const info = await this.traitComposer.tokenInfo(tokenId);
			if (info) {
				const tier = tierForScore(info.ranking);
				parts.push(
					kindLabel(tokenId, info.kind),
					genderLabel(info.gender),
					tier.name,
					String(info.ranking),
				);
				if (info.series !== null && info.series !== undefined) {
					parts.push(Strings.cards.series(info.series));
				}
			}
			const picks = await this.traitComposer.picksFor(tokenId);
			for (const pick of picks) {
				parts.push(pick.name, pick.geneName);
			}
		} catch (error) {
			// A token the library cannot compose is findable by id only
		}
		return parts.join(" ").toLowerCase();
	}

	/// Flip a card over (or back). At most one card shows its back
	/// at a time so the grid never becomes a wall of backs.
	flipCard(tokenId) {
		const id = String(tokenId);
		const previous = this.flippedTokenId;
		if (previous && this.gridItems[previous]) {
			this.gridItems[previous].classList.remove("flipped");
		}
		this.flippedTokenId = null;
		if (previous === id) {
			return;
		}
		if (!this.gridItems[id]) {
			return;
		}
		this.flippedTokenId = id;
		this.gridItems[id].classList.add("flipped");
		this.buildCardBack(tokenId);
	}

	/// Build a card's details back on first flip: the identity
	/// facts (score, gender, series/kind, burn state, Unique-By,
	/// minter) from the local frozen tables. Failures leave the
	/// title-only back rather than throwing out of a click.
	async buildCardBack(tokenId) {
		if (this.backBuilt[tokenId]) {
			return;
		}
		// The flag blocks a concurrent second build; a FAILED build
		// clears it so the next flip retries instead of leaving the
		// back title-only forever (review catch)
		this.backBuilt[tokenId] = true;
		const generation = this.buildGeneration;
		// A logout/rebuild between the tap and this build can have
		// removed the card (review catch): never throw from a click
		const card = this.gridItems[tokenId];
		if (!card) {
			delete this.backBuilt[tokenId];
			return;
		}
		const back = card.querySelector(".cardBack");
		let info = null;
		let ub = null;
		let burnedMask = null;
		let minter = null;
		try {
			info = await this.traitComposer.tokenInfo(tokenId);
			ub = await this.traitComposer.ubFor(tokenId);
			burnedMask = await this.traitComposer.burnedFor(tokenId);
			minter = await this.traitComposer.minterFor(tokenId);
		} catch (error) {
			delete this.backBuilt[tokenId];
			return;
		}
		if (generation !== this.buildGeneration || !back.isConnected) {
			return;
		}
		if (!info) {
			delete this.backBuilt[tokenId];
			return;
		}
		const line = (className, text) => {
			const element = document.createElement("div");
			element.setAttribute("class", className);
			element.innerText = text;
			back.appendChild(element);
			return element;
		};
		const tier = tierForScore(info.ranking);
		const score = document.createElement("div");
		score.setAttribute("class", "cardBackLine cardBackScore");
		score.appendChild(rarityIcon(tier.rarity));
		const scoreText = document.createElement("span");
		scoreText.innerText = Strings.traits.score(info.ranking, tier.name);
		scoreText.style.color = tier.color;
		score.appendChild(scoreText);
		back.appendChild(score);
		const facts = [genderLabel(info.gender), kindLabel(tokenId, info.kind)];
		if (info.series !== null && info.series !== undefined) {
			facts.push(Strings.traits.series(info.series));
		}
		line("cardBackLine", facts.join(" · "));
		// Burn state mirrors the identity card: mint condition or a
		// count (replicants have no burn concept - mask is null)
		if (burnedMask === 0) {
			line("cardBackLine", Strings.traits.mintCondition);
		} else if (burnedMask !== null) {
			let burnedCount = 0;
			for (let gene = 0; gene < 12; gene++) {
				if (burnedMask & (1 << gene)) {
					burnedCount++;
				}
			}
			const burned = document.createElement("div");
			burned.setAttribute("class", "cardBackLine cardBackBurned");
			burned.appendChild(flameIcon());
			const burnedText = document.createElement("span");
			burnedText.innerText = Strings.traits.burnedCount(burnedCount);
			burned.appendChild(burnedText);
			back.appendChild(burned);
		}
		if (ub) {
			line("cardBackLine", Strings.traits.uniqueByCombos(ub.u2, ub.u3));
		}
		// Full trait list (operator QA 2026-09-01): all 12 traits,
		// tier-marked, burned genes carrying their flame. Gene names
		// ride as tooltips - the card is too small for both columns.
		try {
			const picks = await this.traitComposer.picksFor(tokenId);
			if (generation === this.buildGeneration && back.isConnected) {
				const list = document.createElement("div");
				list.setAttribute("class", "cardTraits");
				picks.forEach((pick, gene) => {
					const row = document.createElement("div");
					row.setAttribute("class", "cardTraitRow");
					row.setAttribute("title", pick.geneName);
					row.appendChild(rarityIcon(pick.rarity));
					const name = document.createElement("span");
					name.innerText = pick.name;
					row.appendChild(name);
					if (burnedMask !== null && burnedMask & (1 << gene)) {
						row.appendChild(flameIcon());
					}
					list.appendChild(row);
				});
				back.appendChild(list);
			}
		} catch (error) {
			// A token the library cannot compose keeps a factual back
			// with no trait list (same degradation as the main render)
		}
		// picksFor awaited above: re-check the guards so a stale
		// session never appends to a detached back (review catch)
		if (generation !== this.buildGeneration || !back.isConnected) {
			return;
		}
		// Hardening: only a well-formed address becomes an outbound
		// link (the committed table is trusted, but cheap to verify)
		if (minter && /^0x[0-9a-fA-F]{40}$/.test(minter)) {
			const minterLine = document.createElement("a");
			minterLine.setAttribute("class", "cardMinter");
			minterLine.href = "https://etherscan.io/address/" + minter;
			minterLine.target = "_blank";
			minterLine.rel = "noopener noreferrer";
			minterLine.innerText = Strings.traits.mintedBy(
				minter.slice(0, 6) + "…" + minter.slice(-4),
			);
			minterLine.setAttribute("title", minter);
			// A link tap must not bubble into card behaviors
			minterLine.addEventListener("click", (event) => event.stopPropagation());
			back.appendChild(minterLine);
		}
		this.attachScrollMore(back);
	}

	/// The scroll-for-more affordance (operator QA 2026-09-01): a ▾
	/// pinned at the back's bottom edge whenever content overflows,
	/// doubling as a page-down button; it hides at the bottom. Added
	/// LAST so the sticky pin sits below every content line.
	attachScrollMore(back) {
		const more = document.createElement("div");
		more.setAttribute("class", "cardMore");
		more.setAttribute("title", Strings.cards.more);
		more.innerText = "▾";
		more.addEventListener("click", (event) => {
			event.stopPropagation();
			const instant = window.matchMedia(
				"(prefers-reduced-motion: reduce)",
			).matches;
			back.scrollBy({
				top: back.clientHeight * 0.7,
				behavior: instant ? "auto" : "smooth",
			});
		});
		back.appendChild(more);
		const update = () => {
			const atBottom =
				back.scrollTop + back.clientHeight >= back.scrollHeight - 8;
			const scrollable = back.scrollHeight > back.clientHeight + 8;
			more.classList.toggle("hidden", atBottom || !scrollable);
		};
		back.addEventListener("scroll", update);
		update();
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

	/// Render each owned Avastar into its grid tile, composed from
	/// the trait library — instant and walletless
	/// (docs/tads/profile-drawer.md Decision 9)
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
				const svgString = await this.traitComposer.composeSVG(tokenId);
				// The grid may have been rebuilt while the render was
				// in flight: a stale loop must not touch the new
				// session's cache, items, or in-flight flag
				if (generation !== this.buildGeneration) {
					return;
				}
				this.thumbnailCache[tokenId] = true;
				const art = this.gridItems[tokenId].querySelector(".cardArt");
				art.innerHTML = "";
				art.appendChild(svgToImage(svgString));
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

	/// Log out: clear the grid and the remembered wallet, and return
	/// the drawer to the disconnected state. The wallet extension
	/// itself stays authorized (pages cannot revoke that), so a
	/// later Link Wallet reconnects without a prompt.
	logout() {
		// Kill any in-flight thumbnail loop the same way a rebuild
		// would
		this.buildGeneration = (this.buildGeneration || 0) + 1;
		this.isLoadingThumbnails = false;
		this.ownedTokenIds = [];
		this.thumbnailCache = {};
		this.gridItems = {};
		this.backBuilt = {};
		this.flippedTokenId = null;
		this.searchText = {};
		this.filterInput.value = "";
		this.filterInput.style.display = "none";
		// currentTokenId survives: logout does not change what is
		// displayed, and a reconnect to the same token short-circuits
		// the load (no finishLoad -> no setCurrent), so the rebuilt
		// grid restores its highlight from here
		this.grid.innerHTML = "";
		this.avastarLoader.forgetWallet();
		this.setWalletState("disconnected");
		this.callbacks.onLoggedOut();
	}

	/// Entry point for the connect button: with several wallets
	/// installed show a chooser first, otherwise connect directly.
	/// Fired from click listeners, so it must swallow its own
	/// rejections — an unhandled one would fail silently anyway,
	/// this way it at least logs.
	async connectWallet() {
		try {
			// A connect tap ends a logged-out state
			this.avastarLoader.clearLoggedOut();
			const wallets = await this.avastarLoader.getWallets();
			if (wallets.length > 1) {
				this.toggleWalletChooser(wallets);
				return;
			}
			await this.continueConnect();
		} catch (error) {
			console.error("Wallet connect failed", error);
		}
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
			name.innerText =
				(wallet.info && wallet.info.name) || Strings.profile.walletFallbackName;
			row.appendChild(name);
			row.addEventListener(
				"click",
				function () {
					this.avastarLoader.selectWallet(wallet);
					this.walletList.remove();
					this.walletList = null;
					this.continueConnect().catch((error) =>
						console.error("Wallet connect failed", error),
					);
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
			// listener. An unresponsive wallet must not become a
			// silent dropped promise: log and leave the button.
			let onMainnet = false;
			try {
				onMainnet = await this.avastarLoader.isMainnet();
			} catch (error) {
				console.error("Wallet network check failed", error);
				return;
			}
			if (!onMainnet) {
				let switched = false;
				try {
					switched = await this.avastarLoader.switchToMainnet();
				} catch (error) {
					console.error("Network switch failed", error);
					return;
				}
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
