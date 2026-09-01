import { Strings } from "./Strings.js";
import { TIERS, rarityIcon, flameIcon } from "./RarityIcons.js";

/// Static content for the info drawer (docs/tads/info-tab.md
/// Decision 3): the "How rarity works" explainer. Every fact here
/// is frozen and verified in docs/tads/design-cues.md and
/// burned-traits.md — no data fetches, pure DOM.

/// The verified score ranges per tier, matching tierForScore's
/// band edges (<33 / <41 / <50 / <60 / 60+)
const TIER_RANGES = ["1–32", "33–40", "41–49", "50–59", "60–100"];

/// Explainer strings support two bits of structure the editor can
/// type directly: newlines (innerText renders them as breaks) and
/// [text](url) links. Everything is built as DOM nodes - no
/// innerHTML - so string content can never inject markup.
const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function appendText(element, text) {
	if (!text) return;
	const span = document.createElement("span");
	span.innerText = text;
	element.appendChild(span);
}

function paragraph(text) {
	const element = document.createElement("p");
	element.setAttribute("class", "infoText");
	let last = 0;
	for (const match of text.matchAll(LINK_PATTERN)) {
		appendText(element, text.slice(last, match.index));
		const link = document.createElement("a");
		link.setAttribute("class", "infoLink");
		link.href = match[2];
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		link.innerText = match[1];
		element.appendChild(link);
		last = match.index + match[0].length;
	}
	appendText(element, text.slice(last));
	return element;
}

/// - Returns: The explainer element for addSection
export function rarityExplainer() {
	const container = document.createElement("div");
	container.setAttribute("class", "infoExplainer");

	container.appendChild(paragraph(Strings.info.scoreIntro));

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

	container.appendChild(paragraph(Strings.info.traitTiers));
	container.appendChild(paragraph(Strings.info.uniqueBy));

	// Burned traits get their flame so the mark reads back to the
	// trait cards; the ember color comes from --burned via
	// currentColor, same as everywhere else
	const burnedNote = document.createElement("p");
	burnedNote.setAttribute("class", "infoText infoBurnedNote");
	burnedNote.appendChild(flameIcon());
	const burnedText = document.createElement("span");
	burnedText.innerText = Strings.info.burned;
	burnedNote.appendChild(burnedText);
	container.appendChild(burnedNote);

	return container;
}
