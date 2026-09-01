import { Strings } from "./Strings.js";
import Scene from "./Scene.js";
import Size from "./Size.js";
import Point from "./Point.js";
import AvastarLoader from "./AvastarLoader.js";
import TraitComposer from "./TraitComposer.js";
import LayerSprings from "./LayerSprings.js";
import ProfileSection from "./ProfileSection.js";
import SidePanel from "./SidePanel.js";
import LoadSection from "./LoadSection.js";
import EffectsSection from "./EffectsSection.js";
import TraitsSection from "./TraitsSection.js";
import TraitEditModal from "./TraitEditModal.js";
import VRMSection, { progressText } from "./VRMSection.js";
import VRMSource from "./VRMSource.js";
import VRMViewer from "./VRMViewer.js";
import VRMLoadingUI from "./VRMLoadingUI.js";
import ZoomView from "./ZoomView.js";
import { rarityExplainer } from "./InfoSections.js";
import { svgToImage } from "./UIHelpers.js";

/// The Avastars scene: load orchestration and rendering. The
/// wallet/picker UI lives in the profile drawer (ProfileSection)
/// and the physics in LayerSprings; this class owns the async-race
/// machinery that keeps loads, resizes, and picks from overwriting
/// each other.
export default class MainScene extends Scene {
	/// Overridden constructor
	constructor(rootContainer) {
		super(rootContainer);
		console.log("kwigbelle build 2026-09-01.4 (punchy cards + trait list)");
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
		this.layerSprings = new LayerSprings();
		// Pinch-to-zoom (docs/tads/pinch-zoom.md): draw-time view
		// state; the settle callback is Decision 1's vector re-raster
		this.zoomView = new ZoomView(
			() => ({ width: this.canvas.width, height: this.canvas.height }),
			() => this.rerasterLayers(),
		);
		// The right-side panel: effects controls drive the spring
		// rig; trait rows drive per-layer visibility that the render
		// loop consults each frame
		this.sidePanel = new SidePanel(rootContainer);
		// Object used to load the Avastar SVG from on chain
		this.avastarLoader = new AvastarLoader(null);
		// The profile drawer (docs/tads/profile-drawer.md): the tab
		// above settings holding the wallet connect flow and the
		// owned-Avastars grid. Registered first so its handle stacks
		// on top; picks and connects come back through callbacks.
		this.profileSection = new ProfileSection(
			this.avastarLoader,
			this.traitComposer,
			{
				onConnected: (ownedTokenIds) => {
					this.recordOwnership(ownedTokenIds);
					this.profileSection.buildGrid(ownedTokenIds);
					this.sidePanel.setBadge("profile", true);
					if (ownedTokenIds.length > 0) {
						this.selectAvastar(ownedTokenIds[0], false);
					}
				},
				onPick: (tokenId) => {
					// The drawer STAYS OPEN (operator QA 2026-08-28): the
					// grid highlights the pick and browsing continues
					this.selectAvastar(tokenId);
				},
				onLoggedOut: () => {
					// Ownership gates (Download VRM) close; the displayed
					// Avastar stays up
					this.recordOwnership([]);
					this.sidePanel.setBadge("profile", false);
				},
				isDrawerOpen: () => this.sidePanel.isOpen("profile"),
			},
		);
		const profileColumn = this.sidePanel.addDrawer(
			"profile",
			ProfileSection.handleIcon(),
			{
				handleId: "profileHandle",
				onOpen: () => this.profileSection.onOpen(),
				// Always-visible wallet presence: grey = logged out,
				// pulsing green = connected (operator QA — the
				// appearing accent dot read as decoration, not state)
				statusDot: true,
			},
		);
		profileColumn.appendChild(this.profileSection.build());
		// The info drawer (docs/tads/info-tab.md): information about
		// the displayed Avastar, stacked between profile and settings.
		// Registered before any settings section so its handle takes
		// the middle slot (drawer stack order = registration order).
		// Section order per operator QA: the static rarity explainer
		// (collapsed by default), then Overview (the identity card),
		// then the trait cards.
		this.traitsSection = new TraitsSection({
			onEdit: (gene) => this.openTraitEditor(gene),
			onUndo: (gene) => this.undoOverride(gene),
			onResetAll: () => this.resetOverrides(),
			ubFor: (tokenId) => this.traitComposer.ubFor(tokenId),
			burnedFor: (tokenId) => this.traitComposer.burnedFor(tokenId),
			minterFor: (tokenId) => this.traitComposer.minterFor(tokenId),
		});
		this.sidePanel.addSection(
			Strings.panel.howRarityWorks,
			rarityExplainer(),
			"info",
			true,
		);
		this.sidePanel.addSection(
			Strings.panel.overview,
			this.traitsSection.buildOverview(),
			"info",
		);
		this.sidePanel.addSection(
			Strings.panel.traits,
			this.traitsSection.build(),
			"info",
		);
		// Settings drawer, top section: view any Avastar by token id
		// (walletless - composition needs only the static library)
		this.loadSection = new LoadSection(
			(tokenId) => this.traitComposer.hasToken(tokenId),
			(tokenId) => this.selectAvastar(tokenId),
		);
		this.sidePanel.addSection(
			Strings.panel.loadAvastar,
			this.loadSection.build(),
		);
		// Tilt follow (docs/tads/burned-traits.md Decision 10): the
		// section owns the toggle, the scene owns the sensor wiring
		this.tiltPoint = null;
		this.effectsSection = new EffectsSection(this.layerSprings, {
			onTiltChanged: (enabled) => this.setTiltEnabled(enabled),
		});
		// The Effects section element is kept so 3D mode can hide it
		// wholesale: the spring rig has no meaning for the 3D model
		this.effectsSectionElement = this.sidePanel.addSection(
			Strings.panel.effects,
			this.effectsSection.build(),
		);
		this.vrmSection = new VRMSection(
			() => this.toggle3D(),
			() => this.downloadVRM(),
		);
		this.sidePanel.addSection(Strings.panel.vrm, this.vrmSection.build());
		this.traitEditModal = new TraitEditModal(this.traitComposer);
		// Trait swap preview state (docs/tads/avastar-lab.md): the
		// loaded token's picks plus per-gene overrides
		this.baselinePicks = null;
		this.overrides = new Map();
		// The 3D view (docs/tads/vrm-viewer.md): fetched on demand,
		// shown on its own canvas; vrmGeneration is bumped by every
		// mode transition AND by beginLoad, so a stale fetch or
		// parse completion can never mount over a newer state
		this.vrmSource = new VRMSource();
		// Mirror-first 3D (docs/tads/vrm-mirror.md Decision 5): the
		// hash corpus derives the mirror filename, so the happy path
		// makes no avastars.io call and outlives that endpoint
		this.vrmSource.kindFor = async (tokenId) => {
			const info = await this.traitComposer.tokenInfo(tokenId);
			return info ? info.kind : null;
		};
		this.vrmViewer = new VRMViewer(rootContainer);
		// A tap on the loading overlay cancels the fetch (toggle3D
		// reads a tap during vrmAbort as a cancel)
		this.vrmLoading = new VRMLoadingUI(rootContainer, () => this.toggle3D());
		this.is3D = false;
		this.vrmGeneration = 0;
		this.vrmAbort = null;
		// Tokens the connected wallet owns (string ids): gates the
		// Download VRM button in the 3D model section
		this.ownedTokenIds = new Set();
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
			this.profileSection.setWalletState("none");
			return;
		}
		// A logged-out user stays logged out across reloads: no
		// silent enumeration until they tap Link Wallet again
		if (this.avastarLoader.isLoggedOut()) {
			this.profileSection.setWalletState("disconnected");
			return;
		}
		// Never prompt on page load: only a silent account check.
		// The profile drawer's Link Wallet button handles first
		// time connects.
		let ownedTokenIds = [];
		try {
			ownedTokenIds = await this.avastarLoader.getOwnedTokenIds(false);
		} catch (error) {
			console.error("Could not list the wallet's Avastars", error);
		}
		if (ownedTokenIds.length > 0) {
			this.recordOwnership(ownedTokenIds);
			this.profileSection.setWalletState("connected");
			this.profileSection.buildGrid(ownedTokenIds);
			this.sidePanel.setBadge("profile", true);
			if (!tokenParam) {
				// Swap silently: keep the current Avastar animating
				// until the wallet's first one has rendered
				this.selectAvastar(ownedTokenIds[0], true);
			}
			return;
		}
		// The wallet needs help from the user: either it is on the
		// wrong network for this site, or it has not authorized the
		// site yet. The profile drawer shows whichever fix applies.
		const onMainnet = await this.avastarLoader.isMainnet();
		if (!onMainnet) {
			this.profileSection.setWalletState("wrongNetwork");
			return;
		}
		const accounts = await this.avastarLoader.provider
			.request({ method: "eth_accounts" })
			.catch(() => []);
		if (!accounts || accounts.length === 0) {
			this.profileSection.setWalletState("disconnected");
			return;
		}
		// Authorized on mainnet but no Avastars: still a connected
		// wallet — the drawer says so instead of showing nothing
		this.profileSection.setWalletState("connected");
		this.profileSection.buildGrid([]);
		this.sidePanel.setBadge("profile", true);
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
		// Every load path funnels through here, so this is the single
		// choke point that returns 3D mode to vector: the load flow is
		// vector-native and the user opts into 3D per token
		this.exit3D();
		// Zoom is transient view state (docs/tads/pinch-zoom.md
		// Decision 5): every token load starts at 1x
		this.zoomView.reset();
		// Any in-flight preview recompose belongs to the previous
		// display: invalidate it now, or an A->B->A reload could let
		// a stale overridden render land on A's fresh baseline (its
		// token id matches again, but overrides were reset)
		this.previewGeneration = (this.previewGeneration || 0) + 1;
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
					// Identity facts are properties of the loaded
					// TOKEN: previews re-stamp them from here
					this.baseKind = composed.kind;
					this.baseSeries = composed.series;
					this.baseRanking = composed.ranking;
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
		// Identity chips need no composition - pure hash-corpus
		// lookup, so even a failed composition shows kind/series
		const info = await this.traitComposer.tokenInfo(tokenId).catch(() => null);
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
						kind: info ? info.kind : null,
						series: info ? info.series : null,
						ranking: info ? info.ranking : null,
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
	staticImage(
		svgString,
		width = this.canvas.width,
		height = this.canvas.height,
	) {
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
		// 3D shares the vector view's background (Decision 6 revised),
		// so the token color applies in either mode
		const contentView = document.getElementById("contentView");
		if (this.avastar && this.avastar.backgroundColor) {
			contentView.style.backgroundColor = this.avastar.backgroundColor;
		}
		this.isLoading = false;
		this.preloader.style.opacity = 0;
		this.profileSection.setCurrent(this.avastarLoader.tokenId);
		this.traitsSection.update(this.avastar);
		this.vrmSection.setOwned(
			this.ownedTokenIds.has(String(this.avastarLoader.tokenId)),
		);
		// The backup indicator probes the SAME absolute mirror URL
		// the serving lane uses - one source of truth, truthful from
		// any origin once the mirror CORS lands (review catch). The
		// load generation gates the async URL derivation so a stale
		// load's resolution can't repaint a newer token's verdict.
		if (this.avastar && this.avastar.tokenId != null) {
			this.vrmSource
				.mirrorURL(this.avastar.tokenId)
				.then((url) => {
					// Returned so the chain also covers a rejection from
					// setMirrorCheck itself (review catch)
					if (generation === this.loadGeneration) {
						return this.vrmSection.setMirrorCheck(url);
					}
				})
				.catch(() => {
					// A failed derivation hides the row rather than
					// surfacing as an unhandled rejection (review catch)
					if (generation === this.loadGeneration) {
						return this.vrmSection.setMirrorCheck(null);
					}
				});
		} else {
			this.vrmSection.setMirrorCheck(null);
		}
	}

	/// Remember which tokens the connected wallet owns and refresh
	/// the download gate for whatever is currently displayed
	///
	/// - Parameter ownedTokenIds: The wallet's token ids
	recordOwnership(ownedTokenIds) {
		this.ownedTokenIds = new Set(ownedTokenIds.map(String));
		if (this.avastar && this.avastar.tokenId != null) {
			this.vrmSection.setOwned(
				this.ownedTokenIds.has(String(this.avastar.tokenId)),
			);
		}
	}

	/// Load a picked Avastar. The current Avastar keeps animating
	/// while the new one loads.
	///
	/// - Parameters:
	///		- tokenId: The token id to load
	///		- isSilent: When true no preloader is shown (used for
	///			the automatic swap to the wallet's first Avastar)
	selectAvastar(tokenId, isSilent) {
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

	// Poke (docs/tads/burned-traits.md Decision 10): a quick tap
	// with little movement kicks the layers; a drag stays the
	// follow gesture. UI overlays stopSceneEvents their press
	// events, so beginTap never fires for panel taps (their release
	// propagates, but finishTap no-ops without a matching start).

	touchStart(event) {
		// Two fingers = pinch (docs/tads/pinch-zoom.md Decision 2):
		// the tap is disarmed, follow/pan hand over to the gesture.
		// In 3D the pinch belongs to OrbitControls - driving the 2D
		// zoom from here left the vector view silently zoomed on
		// return (operator QA 2026-08-29)
		if (event.touches.length >= 2) {
			if (this.is3D) {
				return;
			}
			this.seedPinch(event);
			this.tapStart = null;
			this.isTouchDown = false;
			this.panLast = null;
			this.lastTouchTime = performance.now();
			return;
		}
		super.touchStart(event);
		this.lastTouchTime = performance.now();
		this.beginTap(this.touchPoint);
		// Zoomed in, a single-finger drag pans (Decision 2)
		this.panLast = this.zoomView.isZoomed ? this.touchPoint : null;
	}

	touchMove(event) {
		if (event.touches.length >= 2) {
			if (this.is3D) {
				return;
			}
			// A second finger can land without a fresh touchstart
			// reaching us; seed on first sight either way. A
			// zero-distance seed (both fingers on one pixel) would
			// divide to NaN/Infinity below (review catch) - reseed
			// until the fingers separate.
			if (this.pinchDistance == null || this.pinchDistance === 0) {
				this.seedPinch(event);
				this.tapStart = null;
				this.isTouchDown = false;
				this.panLast = null;
				return;
			}
			const a = event.touches[0];
			const b = event.touches[1];
			const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
			const mid = new Point(
				(a.clientX + b.clientX) / 2,
				(a.clientY + b.clientY) / 2,
			);
			// Scale about the PREVIOUS midpoint, then translate by its
			// travel: t' = M1 - r*M0 + r*t keeps the content under
			// the fingers exactly. Zooming about the new midpoint
			// would double-count the travel by (M1-M0)(1-r) per frame
			// (review catch - accumulates over a long sliding pinch).
			this.zoomView.zoomAbout(
				distance / this.pinchDistance,
				this.pinchMid.x,
				this.pinchMid.y,
				true,
			);
			this.zoomView.panBy(mid.x - this.pinchMid.x, mid.y - this.pinchMid.y);
			this.pinchDistance = distance;
			this.pinchMid = mid;
			return;
		}
		super.touchMove(event);
		this.panFromDrag();
	}

	touchEnd(event) {
		if (this.pinchDistance != null) {
			if (event && event.touches.length >= 2) {
				// Three fingers down to two: still pinching, but the
				// surviving pair may differ from the tracked one -
				// reseed so the next move doesn't jump (review catch)
				this.seedPinch(event);
				return;
			}
			this.pinchDistance = null;
			this.pinchMid = null;
			this.zoomView.endGesture();
			this.lastTouchTime = performance.now();
			if (event && event.touches.length === 1) {
				// One finger stays down: continue as a pan, never a tap
				// (the pinch already disarmed tapStart)
				this.isTouchDown = true;
				this.touchPoint = new Point(
					event.touches[0].clientX,
					event.touches[0].clientY,
				);
				this.panLast = this.zoomView.isZoomed ? this.touchPoint : null;
				return;
			}
			this.isTouchDown = false;
			this.touchPoint = new Point(0, 0);
			this.panLast = null;
			return;
		}
		// super resets touchPoint to (0,0): capture the release
		// point first. Panel-tap releases propagate here too
		// (stopSceneEvents lets them, to clear a canvas drag that
		// releases over the panel) — only a touch that actually
		// started on the scene may arm the synthetic-mouse window,
		// or a hybrid device would drop a real mouse poke right
		// after a panel tap.
		const wasDown = this.isTouchDown;
		const releasePoint = this.touchPoint;
		super.touchEnd();
		this.panLast = null;
		if (wasDown) {
			this.lastTouchTime = performance.now();
		}
		this.finishTap(releasePoint);
	}

	/// Capture a starting pinch's distance and midpoint
	seedPinch(event) {
		const a = event.touches[0];
		const b = event.touches[1];
		this.pinchDistance = Math.hypot(
			a.clientX - b.clientX,
			a.clientY - b.clientY,
		);
		this.pinchMid = new Point(
			(a.clientX + b.clientX) / 2,
			(a.clientY + b.clientY) / 2,
		);
	}

	/// Shared single-pointer pan step (touch drag and mouse drag):
	/// while zoomed, pressed movement translates the view
	panFromDrag() {
		if (!this.isTouchDown || !this.panLast || !this.zoomView.isZoomed) {
			return;
		}
		this.zoomView.panBy(
			this.touchPoint.x - this.panLast.x,
			this.touchPoint.y - this.panLast.y,
		);
		this.panLast = this.touchPoint;
	}

	/// Browsers replay a touch as synthetic mouse events; counting
	/// those as a second tap would double the poke (or fire one at
	/// the end of a touch drag). touch-action:none suppresses the
	/// synthesis on most engines; this window is the belt to that
	/// suspender.
	isSyntheticMouse() {
		return (
			this.lastTouchTime !== undefined &&
			performance.now() - this.lastTouchTime < 800
		);
	}

	mouseDown(event) {
		super.mouseDown(event);
		if (!this.isSyntheticMouse()) {
			this.beginTap(this.touchPoint);
			this.panLast = this.zoomView.isZoomed ? this.touchPoint : null;
		}
	}

	mouseMove(event) {
		super.mouseMove(event);
		if (!this.isSyntheticMouse()) {
			this.panFromDrag();
		}
	}

	mouseUp() {
		const releasePoint = this.touchPoint;
		super.mouseUp();
		// Unconditionally: nil-ing pan tracking is always safe, even
		// for a synthetic-mouse release where it was never set
		this.panLast = null;
		if (!this.isSyntheticMouse()) {
			this.finishTap(releasePoint);
		}
	}

	beginTap(point) {
		this.tapStart = { time: performance.now(), x: point.x, y: point.y };
	}

	finishTap(point) {
		const start = this.tapStart;
		this.tapStart = null;
		if (!start || this.is3D) {
			return;
		}
		const isQuick = performance.now() - start.time < 250;
		const isStill = Math.hypot(point.x - start.x, point.y - start.y) < 10;
		if (isQuick && isStill) {
			// The springs live in unzoomed scene space (pinch-zoom
			// Decision 6): the impulse lands where the finger touched
			this.layerSprings.poke(this.zoomView.toScene(point));
			// Double-tap = glide back to 1x (pinch-zoom Decision 2).
			// Both taps poke - deliberately: no hold-off latency, the
			// reset just joins the second poke.
			const previous = this.lastPoke;
			this.lastPoke = { time: performance.now(), x: point.x, y: point.y };
			if (
				previous &&
				this.lastPoke.time - previous.time < 350 &&
				Math.hypot(point.x - previous.x, point.y - previous.y) < 40
			) {
				this.zoomView.glideHome();
				this.lastPoke = null;
			}
		}
	}

	/// Attach or detach the tilt sensor (docs/tads/burned-traits.md
	/// Decision 10). The first reading is the neutral baseline;
	/// ±25° of tilt maps to the same follow path as the pointer.
	/// On iOS the permission call needs a user gesture — invoked
	/// from the toggle tap it prompts; restored at page load it
	/// rejects quietly and tilt stays inert until re-toggled.
	setTiltEnabled(enabled) {
		// Every call supersedes any pending permission resolution and
		// detaches the current listener first, so repeated toggles
		// can never stack listeners and a permission grant that lands
		// after a disable can never resurrect the sensor
		this.tiltGeneration = (this.tiltGeneration || 0) + 1;
		const generation = this.tiltGeneration;
		if (this.onTilt) {
			window.removeEventListener("deviceorientation", this.onTilt);
			this.onTilt = null;
		}
		this.tiltPoint = null;
		if (!enabled) {
			return;
		}
		const attach = () => {
			if (generation !== this.tiltGeneration) {
				return;
			}
			this.tiltBaseline = null;
			this.onTilt = (event) => {
				if (event.beta == null || event.gamma == null) {
					return;
				}
				if (!this.tiltBaseline) {
					this.tiltBaseline = { beta: event.beta, gamma: event.gamma };
				}
				const clamp = (value) => Math.max(-1, Math.min(1, value));
				const dx = clamp((event.gamma - this.tiltBaseline.gamma) / 25);
				const dy = clamp((event.beta - this.tiltBaseline.beta) / 25);
				this.tiltPoint = new Point(
					this.canvas.width / 2 + dx * this.canvas.width * 0.4,
					this.canvas.height / 2 + dy * this.canvas.height * 0.4,
				);
			};
			window.addEventListener("deviceorientation", this.onTilt);
		};
		if (
			window.DeviceOrientationEvent &&
			typeof window.DeviceOrientationEvent.requestPermission === "function"
		) {
			window.DeviceOrientationEvent.requestPermission()
				.then((state) => {
					if (state === "granted") {
						attach();
					}
				})
				.catch(() => {
					// Not called from a gesture (page-load restore) or
					// denied: leave the toggle set, sensor inert
				});
		} else {
			attach();
		}
	}

	/// Overridden teardown: the tilt sensor listener and the zoom
	/// suppression/input listeners live outside the base class's
	/// bound set, and the zoom's settle timer must not fire into a
	/// torn-down scene
	destroy() {
		this.setTiltEnabled(false);
		window.removeEventListener("gesturestart", this.onGestureStart);
		window.removeEventListener("gesturechange", this.onGestureChange);
		window.removeEventListener("gestureend", this.onGestureEnd);
		window.removeEventListener("touchmove", this.onSceneTouchMove);
		window.removeEventListener("wheel", this.onSceneWheel);
		this.zoomView.cancelSettle();
		// Releases the panel's document-level dismiss listener
		this.sidePanel.destroy();
		super.destroy();
	}

	resize() {
		// The clamp math and raster sizes are viewport-derived: a
		// resized viewport starts over at 1x (pinch-zoom Decision 5)
		this.zoomView.reset();
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		this.backdropCanvas.width = window.innerWidth;
		this.backdropCanvas.height = window.innerHeight;
		// The dimension assignment above blanked the backdrop bitmap;
		// in 2D the next frame repaints it, but the render loop is
		// paused during 3D - repaint now so the art stays up behind
		// the model (round-4 review, all four panelists)
		this.paintBackdrop();
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
					// rasterScale resets with the base-size rebuild, or a
					// stale value would suppress the next zoom re-raster
					this.avastar = { ...this.avastar, layers: [image], rasterScale: 1 };
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
		// Composed path: a resize render IS a preview render (the
		// current picks at the current size), so it goes through
		// refreshPreview and inherits every staleness guard - preview
		// generation, baseline identity, token identity, captured
		// size. That closes the A->B->A hole a token-and-size-only
		// guard leaves open, and a newer override render always
		// supersedes an older resize render (fragments are cached in
		// the composer, no refetch).
		this.refreshPreview();
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
		// The modal can stay open across a background token load
		// (e.g. the wallet auto-swap): capture the token and baseline
		// it opened for, and discard the pick if either changed - a
		// choice made for one token must never apply to another
		const tokenAtOpen = this.avastar.tokenId;
		const baselineAtOpen = this.baselinePicks;
		const pick = await this.traitEditModal.open(gene, picks[gene], {
			gender: this.baseGender,
			styles: this.avastar.styles,
		});
		if (
			!this.avastar ||
			this.avastar.tokenId !== tokenAtOpen ||
			this.baselinePicks !== baselineAtOpen
		) {
			return;
		}
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

	/// One tap on the 3D toggle: enter 3D from vector, cancel a
	/// fetch in flight, or return to vector from 3D
	toggle3D() {
		if (this.is3D || this.vrmAbort) {
			this.exit3D();
			return;
		}
		this.enter3D();
	}

	/// Fetch and show the displayed token's model. Single-flight:
	/// vrmAbort is set for the whole fetch+parse, and toggle3D turns
	/// any tap during it into a cancel.
	async enter3D() {
		if (!this.avastar || this.avastar.tokenId == null) {
			return;
		}
		const tokenId = this.avastar.tokenId;
		// 3D has its own OrbitControls zoom; the vector zoom resets
		// on entry (pinch-zoom Decision 5)
		this.zoomView.reset();
		this.vrmGeneration++;
		const generation = this.vrmGeneration;
		const controller = new AbortController();
		this.vrmAbort = controller;
		this.setVRMMode("loading");
		try {
			const bytes = await this.vrmSource.fetchVRM(
				tokenId,
				(loaded, total) => {
					if (generation === this.vrmGeneration) {
						this.vrmLoading.setProgress(loaded, total);
						this.vrmSection.setProgress(loaded, total);
					}
				},
				controller.signal,
			);
			if (generation !== this.vrmGeneration) {
				return;
			}
			// Bytes are down; parsing ~9MB takes a beat of its own -
			// keep the overlay honest instead of freezing at 100%
			this.vrmLoading.setPhase("Preparing model…");
			await this.vrmViewer.show(bytes);
			if (generation !== this.vrmGeneration) {
				// Superseded during the async parse (a token load or
				// a cancel tap): unmount what just mounted
				this.vrmViewer.hide();
				return;
			}
			this.vrmAbort = null;
			this.is3D = true;
			this.setVRMMode("3d");
			// Limited settings while 3D shows (operator directive):
			// no spring controls, traits as read-only information
			this.effectsSectionElement.style.display = "none";
			this.traitsSection.setReadOnly(true);
			// The 2D canvas would otherwise show its last LAYER frame
			// through the 3D canvas's transparent background. The
			// backdrop canvas is deliberately NOT cleared: the token's
			// backdrop art stays up behind the model, so 3D keeps the
			// same background as the vector view (docs/tads/info-tab.md
			// Decision 6, revised by operator QA).
			const context = this.canvas.getContext("2d");
			context.clearRect(0, 0, this.canvas.width, this.canvas.height);
		} catch (error) {
			if (generation !== this.vrmGeneration) {
				return;
			}
			this.vrmAbort = null;
			this.setVRMMode("vector");
			if (!error || error.name !== "AbortError") {
				console.warn(`3D view failed for ${tokenId}`, error);
				this.vrmLoading.showError(Strings.vrm.unavailable);
			}
		}
	}

	/// Return to the vector view. Safe to call in any state; bumps
	/// vrmGeneration so anything 3D still in flight goes stale.
	exit3D() {
		// Mode changes reset the vector zoom in BOTH directions
		// (operator QA 2026-08-29): belt to the 3D input guards'
		// suspenders, so no leak path can hand back a zoomed view
		this.zoomView.reset();
		this.vrmGeneration++;
		if (this.vrmAbort) {
			this.vrmAbort.abort();
			this.vrmAbort = null;
		}
		this.vrmViewer.hide();
		this.is3D = false;
		this.setVRMMode("vector");
		this.effectsSectionElement.style.display = "";
		this.traitsSection.setReadOnly(false);
	}

	/// Keep the loading overlay and the panel section in step
	setVRMMode(mode) {
		this.vrmLoading.setMode(mode);
		this.vrmSection.setMode(mode);
	}

	/// Fetch the displayed token's model and hand it to the browser
	/// as a file save under its original name. Owner-only by UI
	/// gating; the token is captured up front, so a token load mid
	/// download still saves the file that was asked for.
	async downloadVRM() {
		if (
			!this.avastar ||
			this.avastar.tokenId == null ||
			this.isDownloadingVRM
		) {
			return;
		}
		const tokenId = this.avastar.tokenId;
		this.isDownloadingVRM = true;
		this.vrmSection.setDownloadState("Preparing…");
		try {
			const info = await this.vrmSource.vrmInfo(tokenId);
			const bytes = await this.vrmSource.fetchVRM(tokenId, (loaded, total) => {
				this.vrmSection.setDownloadState(
					"Downloading… " + progressText(loaded, total),
				);
			});
			const url = URL.createObjectURL(
				new Blob([bytes], { type: "model/gltf-binary" }),
			);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = info.filename;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			// Give the browser time to start the save before revoking
			setTimeout(() => URL.revokeObjectURL(url), 10000);
			this.vrmSection.setDownloadState(null);
		} catch (error) {
			console.warn(`VRM download failed for ${tokenId}`, error);
			this.vrmSection.setDownloadState("Download failed");
			setTimeout(() => this.vrmSection.setDownloadState(null), 4000);
		}
		this.isDownloadingVRM = false;
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
		// Baseline identity is the belt to the generation's braces:
		// beginLoad allocates a fresh picks array even for the same
		// token id, so a stale preview can never pass both checks
		const baselineAtStart = this.baselinePicks;
		// A preview recompose replaces the layer set at base size:
		// zoom starts over (pinch-zoom Decision 5)
		this.zoomView.reset();
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
				if (this.baselinePicks !== baselineAtStart) {
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
				composed.kind = this.baseKind;
				composed.series = this.baseSeries;
				composed.ranking = this.baseRanking;
				this.avastar = composed;
				// A 3D-mode resize lands here with the render loop
				// paused: hand the fresh backdrop raster to its canvas
				// now (a no-op visually in 2D - the next frame repaints)
				this.paintBackdrop();
				// Keep the loader's state honest about what is on
				// screen (the same-token guard reads from it)
				this.avastarLoader.currentAvastar = composed.fullSVG;
				const contentView = document.getElementById("contentView");
				contentView.style.backgroundColor = composed.backgroundColor;
				// The layer count is constant across overrides: keep
				// the springs so the swap doesn't snap the motion
				if (this.layerSprings.springs.length !== composed.layers.length) {
					this.setupLayerSprings();
				}
				this.traitsSection.setOverrides(composed, this.overrides);
			})
			.catch((error) => console.warn("preview recompose failed", error));
	}

	/// Repaint the backdrop's own canvas: cleared, then the art (the
	/// static fallback has no separate background layer, and the
	/// traits panel can hide the backdrop). The render loop calls
	/// this every 2D frame; resize() calls it directly because
	/// assigning canvas dimensions blanks the bitmap and the render
	/// loop is paused while 3D shows (docs/tads/info-tab.md
	/// Decision 6 - the art must stay up behind the model).
	paintBackdrop() {
		const context = this.backdropCanvas.getContext("2d");
		context.clearRect(
			0,
			0,
			this.backdropCanvas.width,
			this.backdropCanvas.height,
		);
		if (
			!this.isLoading &&
			this.avastar &&
			this.avastar.backgroundLayer &&
			this.traitsSection.isBackdropVisible()
		) {
			const layer = this.avastar.backgroundLayer;
			if (!layer.complete) {
				// Compositions resolve while their images still decode;
				// the 60fps loop normally absorbs that, but a one-shot
				// paint (3D-mode resize) would draw nothing silently -
				// repaint when the decode lands, if still current
				layer.addEventListener(
					"load",
					() => {
						if (this.avastar && this.avastar.backgroundLayer === layer) {
							this.paintBackdrop();
						}
					},
					{ once: true },
				);
				return;
			}
			context.drawImage(
				layer,
				0,
				0,
				this.backdropCanvas.width,
				this.backdropCanvas.height,
			);
		}
	}

	render() {
		// 3D mode pauses the whole 2D pass - drawing AND the spring
		// step below - deliberately: nothing 2D is visible, paused
		// springs keep their state, and the dt clamp absorbs the gap
		// on re-entry (docs/tads/vrm-viewer.md)
		if (this.is3D) {
			return;
		}
		const context = this.canvas.getContext("2d");
		// Guarded: the render loop starts in buildUI, before the
		// constructor reaches the section wiring
		const isTrails = !!(
			this.effectsSection && this.effectsSection.trailsEnabled
		);
		if (isTrails) {
			// Trails (docs/tads/burned-traits.md Decision 10): erase a
			// fraction per frame instead of clearing, so motion leaves
			// ghosts behind
			context.globalCompositeOperation = "destination-out";
			context.fillStyle = "rgba(0, 0, 0, 0.22)";
			context.fillRect(0, 0, this.canvas.width, this.canvas.height);
			context.globalCompositeOperation = "source-over";
		} else {
			context.clearRect(0, 0, this.canvas.width, this.canvas.height);
		}
		// The backdrop's canvas redraws fully every frame - it never
		// fades with Trails (the ghosts float over the visible art)
		this.paintBackdrop();
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

		const centerPoint = new Point(
			this.canvas.width / 2,
			this.canvas.height / 2,
		);
		// The double-tap glide home eases per frame (pinch-zoom
		// Decision 2)
		this.zoomView.update(dt);
		// A pressed pointer wins; otherwise the tilt sensor (when
		// enabled) drives the same follow path. Zoomed in, the
		// pressed pointer PANS instead (pinch-zoom Decision 2), so
		// pointer-follow is suppressed and tilt keeps the floor.
		this.layerSprings.step(
			dt,
			now,
			centerPoint,
			this.isTouchDown && !this.zoomView.isZoomed
				? this.touchPoint
				: this.tiltPoint,
		);
		// The zoom is a draw-time transform over unzoomed spring
		// space (pinch-zoom Decision 6); the Trails erase above ran
		// at identity, so ghosts fade uniformly. Layers draw at
		// LOGICAL canvas size explicitly - a settled re-raster swaps
		// in higher-resolution images that land crisp under the
		// scale without moving.
		const zoom = this.zoomView;
		context.setTransform(zoom.scale, 0, 0, zoom.scale, zoom.tx, zoom.ty);
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
				this.canvas.width,
				this.canvas.height,
			);
		}
		context.setTransform(1, 0, 0, 1, 0, 0);
	}

	// "Private Methods"

	/// Method to build the UI needed for this scene
	buildUI() {
		// The backdrop's own canvas, layered BEHIND the moving
		// layers (docs/tads/info-tab.md): Trails fading on the main
		// canvas never erases the art, and the 3D entry clears only
		// the main canvas, so the backdrop stays up behind the
		// transparent VRM canvas
		this.backdropCanvas = document.createElement("canvas");
		this.backdropCanvas.setAttribute("id", "backdropCanvas");
		this.backdropCanvas.width = window.innerWidth;
		this.backdropCanvas.height = window.innerHeight;
		this.rootContainer.appendChild(this.backdropCanvas);
		// Main canvas
		this.canvas = document.createElement("canvas");
		this.canvas.setAttribute("id", "mainCanvas");
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		this.rootContainer.appendChild(this.canvas);
		// The browser's own page zoom must not eat the gesture
		// (docs/tads/pinch-zoom.md Decision 8). These live on WINDOW,
		// not the canvas (operator field report 2026-08-29: a pinch
		// whose finger lands on any overlay - a drawer handle, the
		// hit-testable preloader - escaped canvas-scoped suppression
		// and Safari page-zoomed, wedging the whole interface):
		// - iOS Safari ignores user-scalable=no; its cancelable
		//   proprietary gesture events are the reliable blocker, and
		//   the page has no legitimate browser-pinch surface
		// - multi-touch touchmove is cancelled everywhere as the
		//   belt to touch-action's suspender; single-finger drawer
		//   scrolling is untouched
		// All references are stored so destroy() can remove them -
		// these live outside the base class's bound set, matching
		// the tilt-listener teardown discipline (review catch).
		// Desktop Safari delivers trackpad pinch ONLY as gesture
		// events (no ctrl+wheel, no touches), so gesturechange also
		// DRIVES the zoom there - gated on no touch-pinch being
		// active, because iOS fires gesture AND touch events for
		// the same pinch and the touch path already handles it.
		this.onGestureStart = (event) => {
			event.preventDefault();
			this.gestureScale =
				typeof event.scale === "number" && event.scale > 0 ? event.scale : null;
		};
		this.onGestureChange = (event) => {
			event.preventDefault();
			if (
				this.is3D ||
				this.pinchDistance != null ||
				this.gestureScale == null ||
				typeof event.scale !== "number" ||
				event.scale <= 0
			) {
				return;
			}
			const cx =
				typeof event.clientX === "number"
					? event.clientX
					: this.canvas.width / 2;
			const cy =
				typeof event.clientY === "number"
					? event.clientY
					: this.canvas.height / 2;
			this.zoomView.zoomAbout(event.scale / this.gestureScale, cx, cy, true);
			this.gestureScale = event.scale;
		};
		this.onGestureEnd = (event) => {
			event.preventDefault();
			this.gestureScale = null;
			this.zoomView.endGesture();
		};
		this.onSceneTouchMove = (event) => {
			if (event.touches.length > 1) {
				event.preventDefault();
			}
		};
		window.addEventListener("gesturestart", this.onGestureStart);
		window.addEventListener("gesturechange", this.onGestureChange);
		window.addEventListener("gestureend", this.onGestureEnd);
		window.addEventListener("touchmove", this.onSceneTouchMove, {
			passive: false,
		});
		// The wheel listener lives on WINDOW like all scene input
		// (operator field report 2026-08-29): transparent overlays -
		// the preloader sits hit-testable over center screen - would
		// swallow a canvas-level listener's events, and the cursor
		// is usually over the face. Scope is by target instead:
		// wheel over the drawer stack or a modal keeps its native
		// scrolling (Decision 8), everything else is scene zoom.
		this.onSceneWheel = (event) => {
			if (this.is3D || this.isLoading) {
				// 3D wheel belongs to OrbitControls on its own canvas
				return;
			}
			if (
				event.target instanceof Element &&
				event.target.closest("#sidePanel, #traitModal, #mirrorModal")
			) {
				return;
			}
			event.preventDefault();
			// Exponential mapping keeps trackpad pinch and wheel
			// notches proportional in either direction
			this.zoomView.zoomAbout(
				Math.exp(-event.deltaY * 0.0022),
				event.clientX,
				event.clientY,
			);
		};
		window.addEventListener("wheel", this.onSceneWheel, { passive: false });
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

	/// The crisp phase of pinch-to-zoom (docs/tads/pinch-zoom.md
	/// Decision 1): once the gesture settles, rebuild the layer
	/// rasters from their retained SVG sources at the settled
	/// scale and swap. The draw call renders every raster at
	/// LOGICAL canvas size, so the swap is invisible except for
	/// sharpness. Staleness guards follow the resize pattern:
	/// load generation, raster generation (a newer settle
	/// supersedes), avastar identity, and captured canvas size.
	/// The backdrop never re-rasters - it does not zoom
	/// (Decision 3).
	rerasterLayers() {
		if (this.is3D || this.isLoading || !this.avastar) {
			return;
		}
		const scale = this.zoomView.rasterScale();
		if (scale === (this.avastar.rasterScale || 1)) {
			return;
		}
		const generation = this.loadGeneration;
		this.rasterGeneration = (this.rasterGeneration || 0) + 1;
		const rasterGeneration = this.rasterGeneration;
		const width = this.canvas.width;
		const height = this.canvas.height;
		const avastarAtStart = this.avastar;
		const size = new Size(
			Math.round(width * scale),
			Math.round(height * scale),
		);
		let images;
		if (avastarAtStart.isStatic) {
			images = [
				this.staticImage(avastarAtStart.sourceSVG, size.width, size.height),
			];
		} else if (avastarAtStart.layerSources) {
			images = avastarAtStart.layerSources.map((source) =>
				this.traitComposer.toImage(source, false, size),
			);
		} else {
			return;
		}
		Promise.all(
			images.map(
				(image) =>
					new Promise((resolve, reject) => {
						image.addEventListener("load", resolve, { once: true });
						image.addEventListener("error", reject, { once: true });
					}),
			),
		)
			.then(() => {
				if (
					generation !== this.loadGeneration ||
					rasterGeneration !== this.rasterGeneration ||
					this.avastar !== avastarAtStart ||
					width !== this.canvas.width ||
					height !== this.canvas.height
				) {
					return;
				}
				// Same layer count by construction: the springs carry over
				this.avastar = {
					...avastarAtStart,
					layers: images,
					rasterScale: scale,
				};
			})
			.catch(() => {
				// A failed decode keeps the current (softer) rasters -
				// the view stays correct, just not crisper
			});
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
