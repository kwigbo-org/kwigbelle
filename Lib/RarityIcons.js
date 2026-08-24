/// Rarity tier presentation (docs/tads/design-cues.md): the five
/// avastars.io tier icons and the verified score->tier bands.
/// Icons are inline SVGs so they inherit no font quirks; colors
/// are pinned here as the single source of truth.

export const TIERS = [
	{ name: "Common", color: "#0D8FFB", shape: "square" },
	{ name: "Uncommon", color: "#2ECC71", shape: "circle" },
	{ name: "Rare", color: "#F5A623", shape: "triangle" },
	{ name: "Epic", color: "#7B52D4", shape: "ellipse" },
	{ name: "Legendary", color: "#FF4757", shape: "diamond" },
];

const SVG_NS = "http://www.w3.org/2000/svg";

/// One tier icon as an inline SVG element
///
/// - Parameter rarity: Tier index 0-4 (Common..Legendary)
export function rarityIcon(rarity) {
	const tier = TIERS[rarity];
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("class", "rarityIcon");
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("aria-label", tier.name);
	let shape;
	switch (tier.shape) {
		case "square":
			shape = document.createElementNS(SVG_NS, "rect");
			shape.setAttribute("x", "2.5");
			shape.setAttribute("y", "2.5");
			shape.setAttribute("width", "11");
			shape.setAttribute("height", "11");
			shape.setAttribute("rx", "2");
			break;
		case "circle":
			shape = document.createElementNS(SVG_NS, "circle");
			shape.setAttribute("cx", "8");
			shape.setAttribute("cy", "8");
			shape.setAttribute("r", "5.5");
			break;
		case "triangle":
			shape = document.createElementNS(SVG_NS, "polygon");
			shape.setAttribute("points", "8,2 14.5,13.5 1.5,13.5");
			break;
		case "ellipse":
			shape = document.createElementNS(SVG_NS, "ellipse");
			shape.setAttribute("cx", "8");
			shape.setAttribute("cy", "8");
			shape.setAttribute("rx", "6.5");
			shape.setAttribute("ry", "4.5");
			break;
		default:
			// diamond
			shape = document.createElementNS(SVG_NS, "polygon");
			shape.setAttribute("points", "8,1.5 14.5,8 8,14.5 1.5,8");
	}
	shape.setAttribute("fill", tier.color);
	svg.appendChild(shape);
	return svg;
}

/// The tier a 1-100 score falls in. Band edges verified against
/// the on-chain metadata level attribute at all four boundaries
/// (docs/tads/design-cues.md): <33 / <41 / <50 / <60 / 60+.
///
/// - Parameter score: The token's ranking (1-100)
/// - Returns: { rarity, name, color }
export function tierForScore(score) {
	let rarity;
	if (score < 33) {
		rarity = 0;
	} else if (score < 41) {
		rarity = 1;
	} else if (score < 50) {
		rarity = 2;
	} else if (score < 60) {
		rarity = 3;
	} else {
		rarity = 4;
	}
	return { rarity, name: TIERS[rarity].name, color: TIERS[rarity].color };
}

/// The kind chip label for a token (promo sub-kinds are pure
/// token-id ranges from the Gen-1 series sheet)
///
/// - Parameters:
///		- tokenId: The token id (string or number)
///		- kind: "prime" | "replicant" from the hash corpus
export function kindLabel(tokenId, kind) {
	if (kind === "replicant") {
		return "Replicant";
	}
	const id = Number(tokenId);
	if (id < 100) {
		return "Founder";
	}
	if (id < 200) {
		return "Exclusive";
	}
	return "Prime";
}

/// The burned-trait color (docs/tads/burned-traits.md) - warm
/// ember orange, distinct from every tier color
export const BURNED_COLOR = "#FF8C42";

/// A small flame glyph for burned-trait marks, inline SVG so it
/// takes CSS color like the tier icons
export function flameIcon() {
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("class", "rarityIcon flameIcon");
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("aria-label", "Burned");
	const path = document.createElementNS(SVG_NS, "path");
	path.setAttribute(
		"d",
		"M8 1.5c.4 2.2-.6 3.4-1.7 4.6C5.2 7.3 4 8.6 4 10.7 4 13.1 5.8 15 8 " +
			"15s4-1.9 4-4.3c0-1.9-.9-3.2-1.8-4.3-.3.7-.7 1.2-1.3 1.6.3-2.4-.3" +
			"-4.8-.9-6.5zM8 13.4c-1 0-1.9-.9-1.9-2 0-.9.5-1.5 1-2.1.3.5.8.9 " +
			"1.4 1.1.2.3.4.6.4 1 0 1.1-.4 2-.9 2z",
	);
	path.setAttribute("fill", BURNED_COLOR);
	svg.appendChild(path);
	return svg;
}
