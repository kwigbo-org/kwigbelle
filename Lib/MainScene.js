import Scene from "./Scene.js";
import Size from "./Size.js";
import Point from "./Point.js";
import AvastarLoader from "./AvastarLoader.js";
import TraitComposer from "./TraitComposer.js";
import LayerSprings from "./LayerSprings.js";
import PickerUI from "./PickerUI.js";
import WalletConnectUI from "./WalletConnectUI.js";
import SidePanel from "./SidePanel.js";
import LoadSection from "./LoadSection.js";
import EffectsSection from "./EffectsSection.js";
import TraitsSection from "./TraitsSection.js";
import TraitEditModal from "./TraitEditModal.js";
import { svgToImage } from "./UIHelpers.js";

/// The Avastars scene: load orchestration and rendering. The
/// overlay UI lives in PickerUI/WalletConnectUI and the physics in
/// LayerSprings; this class owns the async-race machinery that
/// keeps loads, resizes, and picks from overwriting each other.
export default class MainScene extends Scene {
	/// Overridden constructor
	constructor(rootContainer) {
		super(rootContainer);
		console.log("kwigbelle build 2026-08-22.7 (trait lab)");
		// Build the UI
		this.buildUI();
		// Start loading
		this.isLoading = true;
		// Check url params for a "tokenId"
		const urlParams = new URLSearchParams(window.location.search.toLowerCase());
		// Trait composition is THE render path
		// (docs/tads/trait-composition.md + retire-legacy.md): layers
		// come from the committed trait library; on failure the token
		// degrades to a single static full-render layer.
		this.traitComposer = new TraitComposer();
		this.layerSprings = new LayerSprings(false);
		// The right-side panel: effects controls drive the spring rig
		// (?explode=1, when explicitly present, wins over the stored
		// setting); trait rows drive per-layer visibility that the
		// render loop consults each frame
		const explodeParam = urlParams.get("explode");
		this.sidePanel = new SidePanel(rootContainer);
		// Top section: view any Avastar by token id (walletless -
		// composition needs only the static library)
		this.loadSection = new LoadSection(
			(tokenId) => this.traitComposer.hasToken(tokenId),
			(tokenId) => this.selectAvastar(tokenId),
		);
		this.sidePanel.addSection("Load Avastar", this.loadSection.build());
		this.effectsSection = new EffectsSection(
			this.layerSprings,
			explodeParam !== null ? explodeParam !== "0" : null,
		);
		this.sidePanel.addSection("Effects", this.effectsSection.build());
		this.traitsSection = new TraitsSection({
			onEdit: (gene) => this.openTraitEditor(gene),
			onUndo: (gene) => this.undoOverride(gene),
			onResetAll: () => this.resetOverrides(),
		});
		this.sidePanel.addSection("Traits", this.traitsSection.build());
		this.traitEditModal = new TraitEditModal(this.traitComposer);
		// Trait swap preview state (docs/tads/avastar-lab.md): the
		// loaded token's picks plus per-gene overrides
		this.baselinePicks = null;
		this.overrides = new Map();
		// Object used to load the Avastar SVG from on chain
		this.avastarLoader = new AvastarLoader(null);
		// Overlay UI components: picks and connects come back into
		// the scene through these callbacks
		this.pickerUI = new PickerUI(rootContainer, this.avastarLoader, (tokenId) =>
			this.selectAvastar(tokenId),
		);
		this.walletUI = new WalletConnectUI(
			rootContainer,
			this.avastarLoader,
			(ownedTokenIds) => {
				this.pickerUI.build(ownedTokenIds);
				this.selectAvastar(ownedTokenIds[0], false);
			},
		);
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
		if (tokenParam) {
			this.beginLoad(tokenParam);
		} else {
			// A random bundled kwigbelle Avastar (composition needs
			// no wallet, so the display starts immediately)
			const bundled = AvastarLoader.BUNDLED_TOKEN_IDS;
			this.beginLoad(bundled[Math.floor(Math.random() * bundled.length)]);
		}
		const hasWallet = await this.avastarLoader.hasWallet();
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
			this.pickerUI.build(ownedTokenIds);
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
			this.walletUI.show("🔗 Switch to Mainnet");
			return;
		}
		const accounts = await this.avastarLoader.provider
			.request({ method: "eth_accounts" })
			.catch(() => []);
		if (!accounts || accounts.length === 0) {
			this.walletUI.show("🔗 Link Wallet");
		}
	}

	/// Start a load through the given function, ignoring stale
	/// completions: an older load finishing after a newer one
	/// started must not overwrite the newer Avastar. Composition is
	/// the only layered path; on failure the token degrades to a
	/// single static full-render layer (staticFallback).
	///
	/// - Parameter tokenId: The token to load
	beginLoad(tokenId) {
		this.loadGeneration = (this.loadGeneration || 0) + 1;
		const generation = this.loadGeneration;
		// Synchronous record of the latest REQUEST: async paths only
		// update loader state on success, and the same-token guard
		// must reflect what the user last asked for, not what last
		// finished loading
		this.requestedTokenId = tokenId != null ? String(tokenId) : null;
		const composeAttempt = () => {
			const width = this.canvas.width;
			const height = this.canvas.height;
			this.traitComposer
				.compose(tokenId, new Size(width, height))
				.then((composed) => {
					if (generation !== this.loadGeneration) {
						return;
					}
					if (width !== this.canvas.width || height !== this.canvas.height) {
						// Canvas resized mid flight: recompose at
						// the current size (fragments are cached)
						composeAttempt();
						return;
					}
					// Keep the loader's state coherent: thumbnails
					// and the same-token guard read from it
					this.avastarLoader.tokenId = tokenId;
					this.avastarLoader.currentAvastar = composed.fullSVG;
					this.avastar = composed;
					// A fresh token load resets the trait swap preview
					this.baselinePicks = composed.traits;
					this.baseGender = composed.gender;
					this.overrides = new Map();
					this.setupLayerSprings();
					this.finishLoad(generation);
				})
				.catch((error) => {
					// A stale failure must not fire the fallback: it
					// would fetch and display a superseded token
					if (generation !== this.loadGeneration) {
						return;
					}
					console.warn(
						`trait composition failed for ${tokenId}, using static fallback`,
						error,
					);
					this.staticFallback(generation, tokenId);
				});
		};
		composeAttempt();
	}

	/// Recover a failed composition with the token's full-render SVG
	/// shown as one static layer riding a single spring, so the site
	/// stays alive instead of stranding the preloader
	async staticFallback(generation, tokenId) {
		let svgString = null;
		try {
			svgString = await this.avastarLoader.fallbackSVG(tokenId);
		} catch (error) {
			if (generation !== this.loadGeneration) {
				return;
			}
			// Nothing to show: recover the UI and keep whatever
			// Avastar is already on screen
			console.error(`fallback load failed for ${tokenId}`, error);
			this.finishLoad(generation);
			return;
		}
		if (generation !== this.loadGeneration) {
			return;
		}
		const attempt = () => {
			// Captured-size staleness: staticImage sizes from the
			// canvas at call time, so a resize while the image was
			// decoding means rebuilding at the current size (same
			// pattern as composeAttempt)
			const width = this.canvas.width;
			const height = this.canvas.height;
			const image = this.staticImage(svgString);
			image.addEventListener(
				"load",
				() => {
					if (generation !== this.loadGeneration) {
						return;
					}
					if (width !== this.canvas.width || height !== this.canvas.height) {
						attempt();
						return;
					}
					this.avastarLoader.tokenId = tokenId;
					this.avastarLoader.currentAvastar = svgString;
					// No picks on the static path: trait editing is
					// unavailable until a composed load succeeds
					this.baselinePicks = null;
					this.overrides = new Map();
					this.avastar = {
						tokenId: tokenId != null ? String(tokenId) : null,
						isStatic: true,
						sourceSVG: svgString,
						backgroundLayer: null,
						layers: [image],
						backgroundColor: this.staticBackgroundColor(svgString),
					};
					this.setupLayerSprings();
					this.finishLoad(generation);
				},
				{ once: true },
			);
			image.addEventListener(
				"error",
				() => {
					if (generation !== this.loadGeneration) {
						return;
					}
					// A malformed SVG must not strand the preloader -
					// recover the UI and keep whatever is on screen
					console.error(
						`static fallback image failed to render for ${tokenId}`,
					);
					this.finishLoad(generation);
				},
				{ once: true },
			);
		};
		attempt();
	}

	/// An img for a full-render SVG sized to the current canvas.
	/// Chain and bundled renders size themselves (1000px or viewBox
	/// only), so the root tag's size is replaced for drawImage.
	staticImage(svgString) {
		const width = this.canvas.width;
		const height = this.canvas.height;
		const sized = svgString.replace(/<svg\b[^>]*>/, (tag) =>
			tag
				.replace(/\s(?:width|height)="[^"]*"/g, "")
				.replace(/<svg/, `<svg width="${width}" height="${height}"`),
		);
		return svgToImage(sized);
	}

	/// The page background color from a full render's style block
	/// (same class the composer reads it from)
	staticBackgroundColor(svgString) {
		const match = svgString.match(
			/\.bg_color\s*\{\s*fill:\s*(#[0-9A-Fa-f]{3,8})/,
		);
		return match ? match[1] : null;
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
		this.pickerUI.updateSelectedThumbnail();
		this.traitsSection.update(this.avastar);
	}

	/// Load a picked Avastar and collapse the picker. The current
	/// Avastar keeps animating while the new one loads.
	///
	/// - Parameters:
	///		- tokenId: The token id to load
	///		- isSilent: When true no preloader is shown (used for
	///			the automatic swap to the wallet's first Avastar)
	selectAvastar(tokenId, isSilent) {
		this.pickerUI.collapse();
		// Guard against the latest REQUESTED token (recorded
		// synchronously in beginLoad), not the loader's last
		// completed one - re-picking the displayed token while a
		// different load is in flight must start a fresh load that
		// supersedes it
		const current =
			this.requestedTokenId != null
				? this.requestedTokenId
				: String(this.avastarLoader.tokenId);
		if (String(tokenId) === current) {
			return;
		}
		if (!isSilent) {
			this.preloader.style.opacity = 1;
		}
		this.beginLoad(tokenId);
	}

	// MARK: Overridden Methods

	resize() {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		if (!this.avastar) {
			return;
		}
		// Rebuild the display at the new size. The load generation is
		// NOT bumped - a resize must not invalidate a pending token
		// load. Staleness guards: captured size (a newer resize wins),
		// and TOKEN identity (rebuilding the currently displayed token
		// must never overwrite a token load that completed in the
		// interim).
		const resizeToken = this.avastar.tokenId;
		const width = this.canvas.width;
		const height = this.canvas.height;
		if (this.avastar.isStatic) {
			const sourceSVG = this.avastar.sourceSVG;
			const image = this.staticImage(sourceSVG);
			image.addEventListener(
				"load",
				() => {
					if (
						!this.avastar ||
						!this.avastar.isStatic ||
						this.avastar.tokenId !== resizeToken
					) {
						return;
					}
					if (width !== this.canvas.width || height !== this.canvas.height) {
						return;
					}
					this.avastar = { ...this.avastar, layers: [image] };
					this.setupLayerSprings();
				},
				{ once: true },
			);
			image.addEventListener(
				"error",
				() => {
					// The SVG decoded before, so this is unexpected -
					// keep the previous image rather than going blank
					console.warn("static resize rerender failed, keeping previous image");
				},
				{ once: true },
			);
			return;
		}
		// Composed path: rebuild layer images at the new size
		// (fragments are cached in the composer, no refetch). Uses
		// the current picks so trait overrides survive a resize.
		const picks = this.currentPicks();
		if (!picks) {
			return;
		}
		this.traitComposer
			.composePicks(picks, new Size(width, height))
			.then((composed) => {
				if (!this.avastar || this.avastar.tokenId !== resizeToken) {
					return;
				}
				if (width !== this.canvas.width || height !== this.canvas.height) {
					return;
				}
				composed.tokenId = resizeToken;
				composed.gender = this.baseGender;
				this.avastar = composed;
				this.setupLayerSprings();
			})
			.catch((error) => console.warn("recompose failed", error));
	}

	/// The trait picks currently on display: the loaded token's
	/// baseline with any preview overrides applied
	currentPicks() {
		if (!this.baselinePicks) {
			return null;
		}
		return this.baselinePicks.map((pick, gene) =>
			this.overrides.has(gene) ? this.overrides.get(gene) : pick,
		);
	}

	/// Open the trait chooser for a gene slot and apply the choice
	async openTraitEditor(gene) {
		const picks = this.currentPicks();
		if (!picks || !this.avastar || !this.avastar.styles) {
			return;
		}
		const pick = await this.traitEditModal.open(gene, picks[gene], {
			gender: this.baseGender,
			styles: this.avastar.styles,
		});
		if (pick && pick.traitId !== picks[gene].traitId) {
			if (
				this.baselinePicks &&
				pick.traitId === this.baselinePicks[gene].traitId
			) {
				// Picking the original back IS the undo
				this.overrides.delete(gene);
			} else {
				this.overrides.set(gene, pick);
			}
			this.refreshPreview();
		}
	}

	/// Revert one gene to the loaded token's trait
	undoOverride(gene) {
		this.overrides.delete(gene);
		this.refreshPreview();
	}

	/// Revert every gene to the loaded token's traits
	resetOverrides() {
		this.overrides.clear();
		this.refreshPreview();
	}

	/// Re-render the display for the current picks. Preview-only
	/// state change: guarded like resize (captured size + token
	/// identity + its own generation for rapid apply/undo), never a
	/// load-generation bump - a pick swap must not invalidate a
	/// pending token load, and a stale swap render must never
	/// overwrite a newer token.
	refreshPreview() {
		const picks = this.currentPicks();
		if (!picks || !this.avastar) {
			return;
		}
		const previewToken = this.avastar.tokenId;
		const width = this.canvas.width;
		const height = this.canvas.height;
		this.previewGeneration = (this.previewGeneration || 0) + 1;
		const generation = this.previewGeneration;
		this.traitComposer
			.composePicks(picks, new Size(width, height))
			.then((composed) => {
				if (generation !== this.previewGeneration) {
					return;
				}
				if (!this.avastar || this.avastar.tokenId !== previewToken) {
					return;
				}
				if (width !== this.canvas.width || height !== this.canvas.height) {
					return;
				}
				composed.tokenId = previewToken;
				composed.gender = this.baseGender;
				this.avastar = composed;
				// Keep the collapsed picker thumbnail honest about
				// what is on screen
				this.avastarLoader.currentAvastar = composed.fullSVG;
				const contentView = document.getElementById("contentView");
				contentView.style.backgroundColor = composed.backgroundColor;
				// The layer count is constant across overrides: keep
				// the springs so the swap doesn't snap the motion
				if (this.layerSprings.springs.length !== composed.layers.length) {
					this.setupLayerSprings();
				}
				this.pickerUI.updateSelectedThumbnail();
				this.traitsSection.setOverrides(composed, this.overrides);
			})
			.catch((error) => console.warn("preview recompose failed", error));
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

		// The static fallback has no separate background layer, and
		// the traits panel can hide the backdrop
		if (
			this.avastar.backgroundLayer &&
			this.traitsSection.isBackdropVisible()
		) {
			context.drawImage(
				this.avastar.backgroundLayer,
				0,
				0,
				this.canvas.width,
				this.canvas.height,
			);
		}

		const centerPoint = new Point(
			this.canvas.width / 2,
			this.canvas.height / 2,
		);
		this.layerSprings.step(
			dt,
			now,
			centerPoint,
			this.isTouchDown ? this.touchPoint : null,
		);
		for (let index = 0; index < this.avastar.layers.length; index++) {
			// Hidden layers keep their springs (indices stay stable);
			// they just aren't drawn
			if (!this.traitsSection.isLayerVisible(index)) {
				continue;
			}
			const spring = this.layerSprings.at(index);
			context.drawImage(
				this.avastar.layers[index],
				spring.x - this.canvas.width / 2,
				spring.y - this.canvas.height / 2,
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

	/// Rebuild the spring rig for the current Avastar's layers.
	/// Shared by the composed and static-fallback paths.
	setupLayerSprings() {
		this.layerSprings.setup(
			this.avastar.layers.length,
			new Point(this.canvas.width / 2, this.canvas.height / 2),
		);
	}
}
