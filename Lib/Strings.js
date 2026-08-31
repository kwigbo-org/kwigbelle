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
/// copy is a ternary OF whole templates (see mirror.gapsLine).
export const Strings = {
	// Drawer section titles (the stacked right-edge panel)
	panel: {
		howRarityWorks: "How rarity works",
		overview: "Overview",
		traits: "Traits",
		loadAvastar: "Load Avastar",
		effects: "Effects",
		vrm: "3D model",
	},

	// Info drawer: the "How rarity works" explainer. FROZEN FACTS -
	// score bands, lottery range, and burn mechanics are verified
	// chain truth (docs/tads/design-cues.md, burned-traits.md);
	// rewording is fine, changing numbers is not.
	info: {
		scoreIntro:
			"Every Avastar carries a rarity score from 1 to 100, " +
			"assigned by the contract at mint from the rarity of its " +
			"12 traits. The score places it in one of five tiers:",
		traitTiers:
			"Each trait has its own contract-assigned tier, shown on " +
			"its card below — each card's outline is tinted by its " +
			"tier.",
		uniqueBy:
			"Unique By counts trait combinations no other Avastar " +
			"wears: a pair (or triple) of this Avastar's traits found " +
			"on no other Series 1–5 lottery prime (#200–25,199). " +
			"Founders, Exclusives, and Replicants didn't play the " +
			"mint lottery, so they carry no Unique By line.",
		// Leading space on purpose: it follows the flame icon inline
		burned:
			" When a replicant was minted, each trait it borrowed was " +
			"burned on its prime. The prime's art is unchanged, but a " +
			"burned trait could never mint another replicant — and with " +
			"the factory closed and the contract locked, burn marks are " +
			"frozen forever. A prime with no burns is in mint condition.",
	},

	// Info drawer: identity card + trait cards
	traits: {
		identityTitle: (tokenId) => `Avastar #${tokenId}`,
		identityTitleUnknown: "Avastar",
		series: (series) => `Gen 1 · Series ${series}`,
		mintCondition: "Mint condition",
		mintedBy: (address) => `Minted by ${address}`,
		score: (ranking, tierName) => `Score ${ranking} · ${tierName}`,
		burnedCount: (count) => `${count} of 12 traits burned`,
		uniqueByCombos: (u2, u3) =>
			`Unique-By combos: 2-trait ${u2} · 3-trait ${u3}`,
		uniqueByQualifier: "(all 12 traits, among Series 1-5 primes)",
		unavailable: "Trait data unavailable for this display",
		threeDNote:
			"The 3D model shows the original on-chain Avastar. Trait " +
			"preview and visibility apply to the vector view.",
		resetAll: "↺ Reset all traits",
		previewOnly: "Preview only — nothing is changed on chain.",
		edit: "✎ Edit",
		was: (name) => `was: ${name}`,
		undo: "↺ undo",
		burnedTag: "Burned",
	},

	// Trait chooser modal
	modal: {
		allGenders: "all genders",
		filterPlaceholder: "Filter by name",
		anyRarity: "Any rarity",
		anySeries: "Any series",
		seriesOption: (value) => `Series ${value + 1}`,
	},

	// Profile drawer: wallet states + owned grid
	profile: {
		noWallet:
			"No Ethereum wallet detected. Install one to see your own " +
			"Avastars here.",
		connected: "Connected",
		logout: "Log out",
		switchNetwork: "🔗 Switch to Mainnet",
		linkWallet: "🔗 Link Wallet",
		emptyWallet: "No Avastars in this wallet.",
		walletFallbackName: "Wallet",
	},

	// Load Avastar section
	load: {
		note: "View any of the 26,617 Avastars by token id — no wallet needed.",
		placeholder: "Token id",
		button: "Load",
		errorNotNumeric: "Enter a numeric token id",
		errorCheckFailed: "Could not check that token id — try again",
		errorUnknown: (tokenId) => `No Avastar has token id ${tokenId}`,
	},

	// Effects section control labels
	effects: {
		pauseMotion: "Pause motion",
		motion: "Motion",
		follow: "Follow",
		lockLayers: "Lock layers",
		wave: "Wave",
		trails: "Trails",
		tiltFollow: "Tilt follow",
	},

	// 3D model section + loading overlay + failure toast
	vrm: {
		note:
			"Every Avastar has an assigned 3D model (VRM), fetched from " +
			"IPFS on demand (~9MB).",
		mirrorInfoTooltip: "VRM backup status",
		download: "⬇ Download VRM",
		downloadState: (text) => `⬇ ${text}`,
		viewIn3D: "View in 3D",
		backToVector: "Back to vector",
		cancelLoading: "Cancel loading",
		loadingShort: "Loading model…",
		loadingShortProgress: (progress) => `Loading model… ${progress}`,
		loadingFull: "Loading 3D model…",
		loadingFullProgress: (progress) => `Loading 3D model… ${progress}`,
		tapToCancel: "Tap to cancel",
		unavailable: "3D model unavailable",
		backupChecking: "Checking backup…",
		backedUp: "Backed up",
		backupPending: "Pending backup",
	},

	// Mirror status modal (the ⓘ in the 3D model section)
	mirror: {
		title: "VRM backup",
		checking: "Checking the mirror…",
		notPublished:
			"The backup status isn't published yet - the mirror " +
			"capture hasn't reported from this site's bucket.",
		headline: (captured, total, percent) =>
			`${captured} of ${total} models backed up (${percent}%)`,
		gbMirrored: (gb) => `${gb} GB safely mirrored`,
		gapsLine: (count, isOne) =>
			isOne
				? `${count} token has no VRM to back up (recorded gaps)`
				: `${count} tokens have no VRM to back up (recorded gaps)`,
		frontLine: (from, until, captured, ago) =>
			`Tokens ${from}–${until}: ${captured} captured · ${ago}`,
		knownMissingTitle: "Known missing",
		knownRange: (from, until, count) =>
			`#${from} – #${until} · ${count} tokens`,
		reasonSource: "Missing from the IPFS source — raised with the project",
		reasonNeverMade:
			"Minted after the last batch — a 3D model was never generated",
		note:
			"The models live on IPFS with a single remaining public " +
			"source; this backup preserves every model that can " +
			"still be fetched.",
		justNow: "just now",
		minutesAgo: (minutes) => `${minutes}m ago`,
		hoursAgo: (hours) => `${hours}h ago`,
		updatedFallback: "updated",
	},
};
