# TAD: Strings — extract editorial copy to a single file

- **Status:** IN REVIEW
- **Driver:** Operator (2026-08-25): "We need to extract all
  strings to a single file so I can pass them to a content
  editor."

## Context

- The site's user-facing copy is scattered across ~10 Lib modules
  as inline `innerText` / `placeholder` / `title` literals — a
  survey (2026-08-26) counts ~70 assignment sites: section notes,
  button labels, the info drawer's rarity explainer, trait-card
  chrome, wallet/profile status lines, VRM loading/toast text, the
  mirror-status modal, and modal headers. Drawer/section titles
  flow through `SidePanel.addSection(title, …)` calls in
  MainScene.
- A content editor cannot be handed ten JS files and asked to find
  the prose between the DOM plumbing. They need one file where
  every editable sentence is visible, grouped by where it appears,
  with parameters legible.
- The repo is a no-build static site: ES modules served as-is.
  Any solution must be a plain module the browser imports — no
  extraction pipeline, no JSON loader, no i18n framework.
- Two kinds of text must NOT travel: **collection vocabulary**
  (trait/gene/variation names in Traits/index.json; tier and kind
  labels in RarityIcons.js; the numeric series identifiers
  rendered as chips — that data is the single design-token source
  and is factual, not editorial) and
  **operational text** (the console build stamp, console
  warnings, error strings only developers see).
- The Tests/ suite asserts rendered copy literally (button labels,
  explainer facts, modal lines). That makes it a copy SPEC: any
  change to what the user reads fails a test until the test is
  updated alongside.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                     | Rationale                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **One module, `Lib/Strings.js`**: a named export `Strings` — a nested plain object grouped by surface (`panel`, `load`, `effects`, `traits`, `info`, `profile`, `vrm`, `mirror`, `modal`, `loading`), values in on-screen order within each group. Modules import it and reference entries; no lookup indirection, no keys-as-strings. | Plain ES module is the house idiom and needs no build step. Grouping by surface means the editor reads the file like a walk through the UI.                                     |
| 2   | **Scope: editorial copy only.** IN: labels, buttons, notes, explainer prose, status/error/toast text users see, input placeholders, tooltip `title` attributes, drawer/section titles. OUT: collection vocabulary (Traits/index.json names; RarityIcons tier/kind labels; the numeric series identifiers rendered as chips in TraitsSection), the console build stamp, console.warn/error text, and test literals.                                                          | The editor owns voice, not facts. Trait names and tier bands are chain/data truth with a single source already; moving them would create a second one.                          |
| 3   | **Parameterized strings are arrow functions** with named parameters: `` gbMirrored: (gb) => `${gb} GB safely mirrored` ``. No template mini-language, no `%s`.                                                                                                                                                                                                                     | The editor sees the placeholder exactly where it lands, and the browser enforces correctness — a broken edit is a visible JS error, not a silent format bug.                    |
| 4   | **index.html text stays in index.html**: its user-facing strings are static HTML attributes (`<title>`, meta description) rather than JS-set runtime text, so moving them to Strings.js would require inventing DOM injection for a handful of strings. They are listed at the top of Strings.js as a commented pointer manifest, so the editor knows they exist and where to edit them. | Completeness for the editor without new mechanism; the page already imports ES modules, so the boundary is "static markup vs runtime text", not module loading.                 |
| 5   | **Section titles come from Strings too**, passed through the existing `addSection(title, …)` calls. KNOWN COUPLING, documented here: collapse persistence keys by title (`kwigbelle.panels`), so retitling a section later resets that section's stored collapse choice to its default. Accepted — a rare one-time niceness cost, not data loss.                                        | Titles are copy. The alternative (separate stable keys) adds a second naming layer to every section for a cosmetic edge case.                                                   |
| 6   | **The extraction PR is mechanical**: byte-identical rendered copy, proven by the full Tests/ suite passing UNCHANGED — the tests literally assert the strings. Copy EDITS come after, as their own PRs, updating the asserting tests in the same diff (the tests are the copy's spec and change log).                                                                                   | Separating the move from the edit makes both reviewable: the move is verified by green tests, the edit is visible as a pure copy diff in one file plus its test updates.        |
| 7   | Ships as two PRs: **PR A** — this TAD. **PR B** — Strings.js + the mechanical extraction across Lib modules.                                                                                                                                                                                                                                                                        | House pattern (vrm-mirror, info-tab): decisions reviewed before diffs.                                                                                                          |

## Progress

- 2026-08-26 — TAD drafted after the copy survey (~70 inline
  string sites across 10 modules; InfoSections' explainer is the
  largest single block). Awaiting review.
