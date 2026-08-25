import { TIERS, rarityIcon, flameIcon } from "./RarityIcons.js";

/// Static content for the info drawer (docs/tads/info-tab.md
/// Decision 3): the "How rarity works" explainer. Every fact here
/// is frozen and verified in docs/tads/design-cues.md and
/// burned-traits.md — no data fetches, pure DOM.

/// The verified score ranges per tier, matching tierForScore's
/// band edges (<33 / <41 / <50 / <60 / 60+)
const TIER_RANGES = ["1–32", "33–40", "41–49", "50–59", "60–100"];

function paragraph(text) {
	const element = document.createElement("p");
	element.setAttribute("class", "infoText");
	element.innerText = text;
	return element;
}

/// - Returns: The explainer element for addSection
export function rarityExplainer() {
	const container = document.createElement("div");
	container.setAttribute("class", "infoExplainer");

	container.appendChild(
		paragraph(
			"Every Avastar carries a rarity score from 1 to 100, " +
				"assigned by the contract at mint from the rarity of its " +
				"12 traits. The score places it in one of five tiers:",
		),
	);

	// The five tiers with their icons and score ranges
	const tierList = document.createElement("div");
	tierList.setAttribute("class", "infoTierList");
	TIERS.forEach((tier, rarity) => {
		const row = document.createElement("div");
		row.setAttribute("class", "infoTierRow");
		row.appendChild(rarityIcon(rarity));
		const name = document.createElement("span");
		name.setAttribute("class", "infoTierName");
		name.innerText = tier.name;
		row.appendChild(name);
		const range = document.createElement("span");
		range.setAttribute("class", "infoTierRange");
		range.innerText = TIER_RANGES[rarity];
		row.appendChild(range);
		tierList.appendChild(row);
	});
	container.appendChild(tierList);

	container.appendChild(
		paragraph(
			"Each trait has its own contract-assigned tier, shown on " +
				"its card below. The identity card's distribution row " +
				"counts the 12 traits by tier.",
		),
	);
	container.appendChild(
		paragraph(
			"Unique By counts trait combinations no other Avastar " +
				"wears: a pair (or triple) of this Avastar's traits found " +
				"on no other Series 1–5 lottery prime (#200–25,199). " +
				"Founders, Exclusives, and Replicants didn't play the " +
				"mint lottery, so they carry no Unique By line.",
		),
	);

	// Burned traits get their flame so the mark reads back to the
	// trait cards; the ember color comes from --burned via
	// currentColor, same as everywhere else
	const burnedNote = document.createElement("p");
	burnedNote.setAttribute("class", "infoText infoBurnedNote");
	burnedNote.appendChild(flameIcon());
	const burnedText = document.createElement("span");
	burnedText.innerText =
		" When a replicant was minted, each trait it borrowed was " +
		"burned on its prime. The prime's art is unchanged, but a " +
		"burned trait could never mint another replicant — and with " +
		"the factory closed and the contract locked, burn marks are " +
		"frozen forever. A prime with no burns is in mint condition.";
	burnedNote.appendChild(burnedText);
	container.appendChild(burnedNote);

	return container;
}
