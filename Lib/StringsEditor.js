import { Strings } from "./Strings.js";
import { StringsMeta } from "./StringsMeta.js";

/// The self-serve copy editor (docs/tads/strings.md Decision 8):
/// renders every Strings entry as a form field with its
/// "where you see this" description, validates edits live, and
/// generates a complete replacement Strings.js - shared via the
/// native share sheet (the editor works on an iPhone) or a plain
/// download. Nothing here touches the server: the output is a file
/// the editor sends back by email, and it enters the repo through
/// the normal review lane.
///
/// Plain strings are edited as text and serialized safely on
/// export. Parameterized strings expose their template SOURCE
/// (backticks, ${placeholders}) - technical, but honest: the
/// field is validated on every keystroke (syntax via Function
/// construction, which never executes the body, plus a check that
/// every original ${…} placeholder survives).

// key ("group.name") -> edited raw value (text, or template body)
const edits = new Map();
const fields = new Map();
const DRAFT_KEY = "kwigbelle.stringsDraft";

const model = [];
for (const [group, entries] of Object.entries(Strings)) {
	for (const [name, value] of Object.entries(entries)) {
		const key = `${group}.${name}`;
		if (typeof value === "function") {
			const source = value.toString();
			const arrow = source.indexOf("=>");
			const params = source.slice(0, arrow).trim();
			const body = source.slice(arrow + 2).trim();
			const placeholders = [...body.matchAll(/\$\{[^}]*\}/g)].map(
				(match) => match[0],
			);
			model.push({
				key,
				group,
				name,
				kind: "template",
				params,
				body,
				placeholders,
			});
		} else {
			model.push({ key, group, name, kind: "text", text: value });
		}
	}
}

const loadDraft = () => {
	try {
		return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {};
	} catch (error) {
		return {};
	}
};

const saveDraft = () => {
	try {
		localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.fromEntries(edits)));
	} catch (error) {
		// Storage unavailable: editing still works, drafts just
		// won't survive a tab eviction
	}
};

/// null when the edited template is sound, else a message
const templateProblem = (entry, body) => {
	try {
		// Constructing the function parses the body WITHOUT running it
		new Function(`return (${entry.params} => ${body});`);
	} catch (error) {
		return "This edit breaks the code structure - check backticks and braces.";
	}
	const missing = entry.placeholders.filter((p) => !body.includes(p));
	if (missing.length > 0) {
		return `Keep the placeholder${missing.length > 1 ? "s" : ""} ${missing.join(", ")} in the text.`;
	}
	return null;
};

const currentValue = (entry) =>
	edits.has(entry.key)
		? edits.get(entry.key)
		: entry.kind === "text"
			? entry.text
			: entry.body;

const problems = () => {
	const list = [];
	for (const entry of model) {
		if (entry.kind !== "template") {
			continue;
		}
		const problem = templateProblem(entry, currentValue(entry));
		if (problem) {
			list.push(entry.key);
		}
	}
	return list;
};

/// The complete replacement Strings.js as text: the header comment
/// block is carried over verbatim from the live file; the object
/// body is regenerated from the model with group comments emitted
/// from StringsMeta. Prettier normalizes formatting on intake.
export async function generate() {
	const source = await (await fetch("Lib/Strings.js")).text();
	const at = source.indexOf("export const Strings = {");
	const header = at > 0 ? source.slice(0, at) : "";
	const wrap = (text) =>
		text
			.split(" ")
			.reduce(
				(lines, word) => {
					const last = lines[lines.length - 1];
					if ((last + " " + word).length > 62) {
						lines.push("\t// " + word);
					} else {
						lines[lines.length - 1] =
							last === "\t//" ? last + " " + word : last + " " + word;
					}
					return lines;
				},
				["\t//"],
			)
			.join("\n");
	const parts = [header + "export const Strings = {"];
	for (const [group] of Object.entries(Strings)) {
		const meta = StringsMeta.groups[group];
		if (meta) {
			parts.push(wrap(`${meta.title}. ${meta.note}`));
		}
		parts.push(`\t${group}: {`);
		for (const entry of model.filter((item) => item.group === group)) {
			const value =
				entry.kind === "text"
					? JSON.stringify(currentValue(entry))
					: `${entry.params} => ${currentValue(entry)}`;
			parts.push(`\t\t${entry.name}: ${value},`);
		}
		parts.push("\t},");
	}
	parts.push("};");
	return parts.join("\n") + "\n";
}

const shareOrDownload = async () => {
	const text = await generate();
	window.__lastGenerated = text;
	const file = new File([text], "Strings.js", { type: "text/javascript" });
	if (navigator.canShare && navigator.canShare({ files: [file] })) {
		try {
			await navigator.share({ files: [file], title: "Strings.js" });
			return;
		} catch (error) {
			// Cancelled or unsupported mid-flight: fall through
		}
	}
	const link = document.createElement("a");
	link.href = URL.createObjectURL(
		new Blob([text], { type: "text/javascript" }),
	);
	link.download = "Strings.js";
	link.click();
	URL.revokeObjectURL(link.href);
};

export function buildEditor(root) {
	const draft = loadDraft();
	for (const [key, value] of Object.entries(draft)) {
		edits.set(key, value);
	}

	const heading = document.createElement("h1");
	heading.innerText = "Avastars copy editor";
	root.appendChild(heading);
	const intro = document.createElement("p");
	intro.setAttribute("class", "editorIntro");
	intro.innerText =
		"Edit any text below, then Share the file back. Your changes " +
		"save as a draft on this device as you type. Fields with " +
		"${placeholders} keep code in the text - edit the words, keep " +
		"the placeholders.";
	root.appendChild(intro);

	if (Object.keys(draft).length > 0) {
		const banner = document.createElement("div");
		banner.setAttribute("class", "editorDraftBanner");
		const note = document.createElement("span");
		note.innerText = "Draft restored from this device.";
		banner.appendChild(note);
		const clear = document.createElement("button");
		clear.innerText = "Discard draft";
		clear.addEventListener("click", () => {
			try {
				localStorage.removeItem(DRAFT_KEY);
			} catch (error) {
				// Nothing to discard
			}
			window.location.reload();
		});
		banner.appendChild(clear);
		root.appendChild(banner);
	}

	for (const [group, entries] of Object.entries(Strings)) {
		const groupMeta = StringsMeta.groups[group] || {};
		const card = document.createElement("section");
		card.setAttribute("class", "editorGroup");
		const title = document.createElement("h2");
		title.innerText = groupMeta.title || group;
		card.appendChild(title);
		if (groupMeta.note) {
			const note = document.createElement("p");
			note.setAttribute("class", "editorGroupNote");
			note.innerText = groupMeta.note;
			card.appendChild(note);
		}
		for (const name of Object.keys(entries)) {
			const key = `${group}.${name}`;
			const entry = model.find((item) => item.key === key);
			const fieldBox = document.createElement("div");
			fieldBox.setAttribute("class", "editorField");
			const description = document.createElement("label");
			description.setAttribute("class", "editorDescription");
			description.innerText = StringsMeta.keys[key] || "(missing description)";
			fieldBox.appendChild(description);
			const input = document.createElement("textarea");
			input.setAttribute("class", "editorInput");
			input.setAttribute("data-key", key);
			input.rows = 2;
			input.value = currentValue(entry);
			const error = document.createElement("div");
			error.setAttribute("class", "editorError");
			const revalidate = () => {
				const edited = input.value;
				if (edited === (entry.kind === "text" ? entry.text : entry.body)) {
					edits.delete(key);
				} else {
					edits.set(key, edited);
				}
				saveDraft();
				const problem =
					entry.kind === "template" ? templateProblem(entry, edited) : null;
				error.innerText = problem || "";
				fieldBox.classList.toggle("hasError", problem !== null);
				refreshShareState();
			};
			input.addEventListener("input", revalidate);
			fieldBox.appendChild(input);
			fieldBox.appendChild(error);
			card.appendChild(fieldBox);
			fields.set(key, { input, revalidate });
		}
		root.appendChild(card);
	}

	const bar = document.createElement("div");
	bar.setAttribute("id", "editorBar");
	const status = document.createElement("span");
	status.setAttribute("id", "editorStatus");
	bar.appendChild(status);
	const share = document.createElement("button");
	share.setAttribute("id", "editorShare");
	share.innerText = "Share file";
	share.addEventListener("click", shareOrDownload);
	bar.appendChild(share);
	root.appendChild(bar);

	const refreshShareState = () => {
		const broken = problems();
		share.disabled = broken.length > 0;
		status.innerText =
			broken.length > 0
				? `Fix ${broken.length} field${broken.length > 1 ? "s" : ""} first`
				: edits.size > 0
					? `${edits.size} change${edits.size > 1 ? "s" : ""} ready`
					: "No changes yet";
	};
	refreshShareState();

	// The test harness drives generate() directly
	window.__stringsEditor = { generate, model };
}
