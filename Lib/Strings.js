/// Every editable sentence the site shows, in one place
/// (docs/tads/strings.md). Grouped by surface, in on-screen order,
/// so this file reads like a walk through the UI. Parameterized
/// entries are arrow functions - the placeholder sits exactly where
/// it lands on screen.
///
/// EDITORIAL COPY ONLY (TAD Decision 2): collection vocabulary
/// (trait/gene names in Traits/index.json, tier and kind labels in
/// RarityIcons.js, numeric series chips), the console build stamp,
/// and developer console text stay at their own sources. Pure
/// glyphs with no words (the ✕ close, the ⓘ info button, the ▾
/// chevron) also stay inline - they are iconography, not prose.
///
/// index.html carries static copy this module cannot reach (TAD
/// Decision 4) - edit these directly there:
///   - the <title> tag
///   - the <meta name="description"> content
///
/// Section titles double as collapse-persistence keys (TAD
/// Decision 5): retitling a section resets its stored
/// collapsed/expanded choice to the default, once, for everyone.
///
/// Keep parameterized entries SIMPLE for the editor page's
/// validator: arrow functions only, no braces inside a ${…}
/// placeholder, and no editable words inside one - conditional
/// copy is a ternary OF whole templates (none currently; the
/// validator still counts placeholder occurrences per branch).
export const Strings = {
	// Panel section titles. Headers of the collapsible sections
	// in the right-side drawers. Careful: renaming one resets
	// whether visitors had it collapsed or expanded, one time.
	panel: {
		howRarityWorks: "How Avastars Rarity Works",
		overview: "Overview",
		traits: "Traits",
		loadAvastar: "Load Avastar",
		effects: "Effects",
		vrm: "3D Model",
	},
	// How rarity works (explainer). The educational text in the
	// info drawer. FROZEN FACTS: score bands, the prime id range,
	// and burn mechanics are verified chain truth - rewording is
	// fine, changing any number is not.
	info: {
		scoreIntro:
			"Every Avastar carries a rarity score from 1 to 100. This was calculated by the contract at mint using the rarity of each Avastar’s 12 traits. The score places it in one of five tiers:",
		traitTiers:
			"Each trait has its own contract-assigned tier, shown on its card below. Each card's outline is tinted in the color that corresponds with its tier.",
		uniqueBy:
			"This “Unique By” rating counts trait combinations that no other Avastar Prime (Generation 1, Series 1-5, id#200-25,199) has. A pair of these traits is represented as “UB2” (triple, “UB3” etc.).  \n\nNote: We specify Avastar Primes here, as UB Scoring only tallies randomly generated Avastars, which consist solely of Primes. \nMore on this:\nAvastar Primes were minted by utilizing a randomly-generated, scroll-to-choose & mint process. See what that looked like [here➡️](https://avastars.io/scroll-simulator)\n\nFounders & Exclusives had “hand-picked” trait combinations, and were designed & minted before the official launch of the Avastars project, so they are not used in the calculation of UB Scores. Replicants were assembled (minted) by burning hand-picked trait copies off of already minted Avastar Primes, after the end of Avastar Prime minting. Thus they are also not included here.",
		// Leading space intentional: rendered inline right after the
		// flame icon (InfoSections.js). Note this comment does not
		// survive an editor-page regeneration - re-add it when
		// landing a regenerated file.
		burned:
			" Every Avastar Prime originally contained one set of 12 facial traits, and, one copy of each of those traits.  In order to create a Replicant, the Replicant Scientist (minter) had to burn 12 trait copies from a combination of 2-5 Avastar Primes. Once a Replicant was minted, each trait copy it took from an Avastar Prime was burned on that Prime. A burned trait copy could never be used again.  With the Replicant Factory now closed (the Replicant minting contract is locked), burn marks are frozen. An Avastar Prime with NO burned traits is in mint condition.",
	},
	// Identity card & trait cards. The info drawer's Overview
	// card and per-trait cards.
	traits: {
		identityTitle: (tokenId) => `Avastar ID#${tokenId}`,
		identityTitleUnknown: "Avastar Unknown",
		series: (series) => `Gen 1 · Series ${series}`,
		mintCondition: "Mint Condition",
		mintedBy: (address) =>
			`Originally Scrolled & Teleported (minted) by ${address}`,
		score: (ranking, tierName) => `Score ${ranking} · ${tierName}`,
		burnedCount: (count) => `${count} of 12 Trait Copies Burned`,
		uniqueByCombos: (u2, u3) =>
			`Unique-By Combos: 2-Trait ${u2} · 3-Trait ${u3}`,
		uniqueByQualifier: "(All 12 traits, among Series 1-5 Primes)",
		unavailable: "Oops! Trait data unavailable for this display 🫣",
		threeDNote:
			"The 3D model view shows the original on-chain Avastar, and ID-accurate background traits. Trait preview and visibility apply to the vector view only.",
		resetAll: "↺ Reset All Traits to Original",
		previewOnly: "PREVIEW ONLY — nothing is changed on-chain. 😮‍💨",
		edit: "✎ Edit",
		was: (name) => `Original Trait: ${name}`,
		undo: "↺ undo",
		burnedTag: "Burned",
	},
	// Trait chooser. The popup for picking a different trait on
	// a card.
	modal: {
		allGenders: "All Genders",
		filterPlaceholder: "Filter By Trait Name",
		anyRarity: "Any Rarity",
		anySeries: "Any Series",
		seriesOption: (value) => `Series ${value + 1}`,
	},
	// Profile drawer (wallet). Wallet connection states and the
	// owned-Avastars grid.
	profile: {
		noWallet:
			"No Ethereum wallet detected. Connect one to see your own Avastars here.",
		connected: "Connected",
		logout: "Log Out",
		switchNetwork: "🔗 Switch to Mainnet",
		linkWallet: "🔗 Link Wallet",
		emptyWallet: "Oops! No Avastars exist in this wallet.",
		walletFallbackName: "Wallet",
	},
	// Wallet trading cards. The owned-Avastars cards in the
	// profile drawer (docs/tads/wallet-cards.md).
	cards: {
		filter: "Filter by trait, id, tier…",
		details: "Card details",
		series: (series) => `S${series}`,
	},
	// Load Avastar. The settings-drawer section for viewing any
	// token.
	load: {
		note: "View any of the 26,617 Avastars by Token ID#— no wallet needed.",
		placeholder: "Token ID#",
		button: "Load Avastar",
		errorNotNumeric: "Enter a Numeric Token ID",
		errorCheckFailed: "Could not check that Token ID. Please try again.",
		errorUnknown: (tokenId) => `No Avastar exists with Token ID # ${tokenId}`,
	},
	// Effects controls. Labels of the motion/effects toggles and
	// sliders.
	effects: {
		pauseMotion: "Pause Motion",
		motion: "Motion",
		follow: "Follow",
		lockLayers: "Lock Layers",
		wave: "Wave",
		trails: "Trails",
		tiltFollow: "Tilt Follow",
	},
	// 3D model section & loading. The 3D model panel section,
	// the center-screen loading overlay, and the failure toast.
	vrm: {
		note: "Every Avastar has an assigned 3D model (VRM), fetched from IPFS on demand (~9MB).",
		mirrorInfoTooltip: "VRM Backup Status",
		download: "⬇ Download VRM",
		downloadState: (text) => `⬇ ${text}`,
		viewIn3D: "View in 3D",
		backToVector: "Back to Vector Avastar",
		cancelLoading: "Cancel Loading",
		loadingShort: "Loading model…please standby…",
		loadingShortProgress: (progress) => `Loading model… ${progress}`,
		loadingFull: "Loading 3D model…please standby…",
		loadingFullProgress: (progress) => `Loading 3D model… ${progress}`,
		tapToCancel: "Tap to Cancel",
		unavailable: "3D Model Currently Unavailable…probably napping…ZZZzzz…",
		backupChecking: "Checking Backup…",
		backedUp: "Backed Up",
		backupPending: "Pending Backup",
	},
	// VRM backup modal. The popup behind the ⓘ button in the 3D
	// model section.
	mirror: {
		title: "VRM Backup",
		checking: "Checking the Mirror…",
		notPublished:
			"The backup status isn't published yet - the mirror capture hasn't reported from this site's bucket.",
		headline: (captured, total, percent) =>
			`${captured} of ${total} models backed up (${percent}%)`,
		gbMirrored: (gb) => `${gb} GB safely mirrored`,
		knownMissingTitle: "Known Missing",
		knownRange: (from, until, count) =>
			`#${from} – #${until} · ${count} tokens`,
		reasonSource: "Missing from the IPFS source — raised with the project",
		reasonNeverMade:
			"Minted after the last batch — a 3D model was never generated",
		note: "The models live on IPFS with a single remaining public source; this backup preserves every model that can still be fetched.",
	},
};
