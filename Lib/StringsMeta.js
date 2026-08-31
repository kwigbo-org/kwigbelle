/// Editor-page companion to Strings.js (docs/tads/strings.md
/// Decision 8): a "where you see this" description for every
/// string, plus a title and note per group. Imported ONLY by
/// avastars-editor.html - the site itself never loads this.
/// The strings-editor test asserts every Strings key has an entry
/// here, so a new string without a description fails the suite.
export const StringsMeta = {
	groups: {
		panel: {
			title: "Panel section titles",
			note:
				"Headers of the collapsible sections in the right-side " +
				"drawers. Careful: renaming one resets whether visitors " +
				"had it collapsed or expanded, one time.",
		},
		info: {
			title: "How rarity works (explainer)",
			note:
				"The educational text in the info drawer. FROZEN FACTS: " +
				"score bands, the lottery range, and burn mechanics are " +
				"verified chain truth - rewording is fine, changing any " +
				"number is not.",
		},
		traits: {
			title: "Identity card & trait cards",
			note: "The info drawer's Overview card and per-trait cards.",
		},
		modal: {
			title: "Trait chooser",
			note: "The popup for picking a different trait on a card.",
		},
		profile: {
			title: "Profile drawer (wallet)",
			note: "Wallet connection states and the owned-Avastars grid.",
		},
		load: {
			title: "Load Avastar",
			note: "The settings-drawer section for viewing any token.",
		},
		effects: {
			title: "Effects controls",
			note: "Labels of the motion/effects toggles and sliders.",
		},
		vrm: {
			title: "3D model section & loading",
			note:
				"The 3D model panel section, the center-screen loading " +
				"overlay, and the failure toast.",
		},
		mirror: {
			title: "VRM backup modal",
			note: "The popup behind the ⓘ button in the 3D model section.",
		},
	},
	keys: {
		"panel.howRarityWorks": "Info drawer: first section's header.",
		"panel.overview": "Info drawer: the identity-card section header.",
		"panel.traits": "Info drawer: the trait-cards section header.",
		"panel.loadAvastar": "Settings drawer: load-by-id section header.",
		"panel.effects": "Settings drawer: effects section header.",
		"panel.vrm": "Settings drawer: 3D model section header.",
		"info.scoreIntro":
			"First paragraph of the explainer, right above the five " + "tier rows.",
		"info.traitTiers": "Paragraph after the tier list, about per-trait tiers.",
		"info.uniqueBy": "Paragraph explaining the Unique By line.",
		"info.burned":
			"The burned-traits note beside the small flame icon. It " +
			"starts with a space on purpose - the text follows the " +
			"icon on the same line.",
		"traits.identityTitle": "Identity card title, e.g. “Avastar #8014”.",
		"traits.identityTitleUnknown":
			"Identity card title when the token id is unknown.",
		"traits.series": "Identity card chip, e.g. “Gen 1 · Series 3”.",
		"traits.mintCondition":
			"Identity card chip shown when a prime has no burned traits.",
		"traits.mintedBy":
			"Identity card line with the original minter's shortened " +
			"address, e.g. \u201cMinted by 0x47c9\u20260ec7\u201d.",
		"traits.score": "Identity card line, e.g. “Score 62 · Legendary”.",
		"traits.burnedCount": "Identity card line, e.g. “3 of 12 traits burned”.",
		"traits.uniqueByCombos":
			"Identity card line with the Unique-By combo counts.",
		"traits.uniqueByQualifier": "Small print under the Unique-By line.",
		"traits.unavailable":
			"Shown in the Traits section when trait data can't be read " +
			"for the current display.",
		"traits.threeDNote":
			"Shown above the trait cards while the 3D view is open.",
		"traits.resetAll": "Button that clears every trait preview at once.",
		"traits.previewOnly":
			"Reassurance note under the trait cards while a preview " + "is active.",
		"traits.edit": "The edit affordance on each trait card.",
		"traits.was": "Shown on an edited card, e.g. “was: Wild Hair”.",
		"traits.undo": "Per-card undo link next to the “was” text.",
		"traits.burnedTag": "The tag on a burned trait's card.",
		"modal.allGenders":
			"Checkbox in the chooser header to show traits for every " + "gender.",
		"modal.filterPlaceholder": "Placeholder of the name filter box.",
		"modal.anyRarity": "Default option of the rarity dropdown.",
		"modal.anySeries": "Default option of the series dropdown.",
		"modal.seriesOption":
			"Series dropdown options; value starts at 0, so the text " + "adds 1.",
		"profile.noWallet":
			"Profile drawer note when no Ethereum wallet is installed.",
		"profile.connected":
			"Shown while the short wallet address is loading (and if " +
			"it can't load).",
		"profile.logout": "Tooltip of the log-out icon.",
		"profile.switchNetwork":
			"Connect button when the wallet is on the wrong network.",
		"profile.linkWallet": "Connect button in its normal state.",
		"profile.emptyWallet": "Shown when the connected wallet owns no Avastars.",
		"profile.walletFallbackName":
			"Fallback name in the wallet chooser when a wallet " +
			"doesn't announce one.",
		"load.note": "Explainer at the top of the Load Avastar section.",
		"load.placeholder": "Placeholder of the token-id input.",
		"load.button": "The load button.",
		"load.errorNotNumeric": "Error under the input for a non-numeric entry.",
		"load.errorCheckFailed":
			"Error when the token-id check itself failed (e.g. offline).",
		"load.errorUnknown":
			"Error for a numeric id that doesn't exist, e.g. “No " +
			"Avastar has token id 99999”.",
		"effects.pauseMotion": "Toggle: freeze all layer motion.",
		"effects.motion": "Slider: idle motion strength.",
		"effects.follow": "Slider: pointer-follow strength.",
		"effects.lockLayers": "Toggle: drag moves the whole face as one piece.",
		"effects.wave": "Toggle: the wave pulse effect.",
		"effects.trails": "Toggle: motion trails.",
		"effects.tiltFollow": "Toggle: follow the phone's tilt.",
		"vrm.note": "Explainer at the top of the 3D model section.",
		"vrm.mirrorInfoTooltip": "Tooltip of the ⓘ backup-status button.",
		"vrm.download": "The download button for owners.",
		"vrm.downloadState":
			"Download button while working; the placeholder is a " +
			"status like “Preparing…”.",
		"vrm.viewIn3D": "The section button in vector view.",
		"vrm.backToVector": "The section button while in 3D view.",
		"vrm.cancelLoading": "The section button while the model loads.",
		"vrm.loadingShort": "Small in-section loading line.",
		"vrm.loadingShortProgress":
			"Small in-section loading line with progress, e.g. " +
			"“Loading model… 62%”.",
		"vrm.loadingFull": "The big center-screen loading text.",
		"vrm.loadingFullProgress":
			"The big center-screen loading text with progress.",
		"vrm.tapToCancel": "Hint under the center-screen loader.",
		"vrm.unavailable":
			"Bottom-center toast when the 3D model can't be fetched.",
		"vrm.backupChecking":
			"Backup indicator at the bottom of the section, while the " +
			"mirror is being checked for this token's model.",
		"vrm.backedUp":
			"Backup indicator (green dot): this token's model is in " + "the mirror.",
		"vrm.backupPending":
			"Backup indicator (red dot): this token's model isn't in " +
			"the mirror yet.",
		"mirror.title": "Backup modal title.",
		"mirror.checking": "Shown while the modal fetches the status.",
		"mirror.notPublished":
			"Shown when no backup status has been published yet.",
		"mirror.headline":
			"The big progress line; placeholders arrive pre-formatted, " +
			"e.g. “1,000 of 26,617 models backed up (3.8%)”.",
		"mirror.gbMirrored": "The gigabytes line under the progress bar.",
		"mirror.knownMissingTitle":
			"Small heading above the known-missing token blocks in " +
			"the backup modal.",
		"mirror.knownRange":
			"The prominent mint-number range line of a known-missing " +
			"block, e.g. “#23,000 – #23,199 · 200 tokens”.",
		"mirror.reasonSource":
			"Reason line under the 23,000-block range: the IPFS " +
			"source itself no longer serves these files.",
		"mirror.reasonNeverMade":
			"Reason line under the 26,530-block range: minted after " +
			"the last VRM batch, so no 3D model ever existed.",
		"mirror.note": "The closing why-this-exists line of the modal.",
	},
};
