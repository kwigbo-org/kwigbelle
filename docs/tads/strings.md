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
- The Tests/ suite asserts many key rendered strings literally
  (button labels, explainer facts, modal lines — ~59 assertions
  across 11 test files), though not every string on the site. For
  the asserted set, a copy change fails a test until the test is
  updated alongside; strings without assertions rely on review of
  the one-file diff. (Wording per PR #35 review.)

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
| 8   | **Self-serve editor page** (operator direction 2026-08-27): `avastars-editor.html` — deployed but unlinked; renders every Strings entry as a form field with a "where you see this" description from `Lib/StringsMeta.js` (editor-page-only import; the strings-editor test enforces exact key coverage both ways). Plain strings are edited as text and serialized safely; parameterized strings expose their template source with live validation (syntax via non-executing Function construction + every original `${…}` placeholder must survive) — invalid fields block sharing with an inline message. Edits persist as a localStorage draft (iOS Safari evicts tabs). Export regenerates the complete Strings.js client-side (header comments carried verbatim, group comments emitted from meta) and hands it over via the native share sheet (`navigator.share` with the file — the editor works on an iPhone) with a plain download fallback. The file comes back by email and enters through the normal review lane — nothing the page does touches the server. | The editor never sees git OR raw JS punctuation; the syntax-breakage class of problems is removed structurally instead of caught in review. Client-side-only fits the no-backend site; the trust boundary stays at the PR lane. |

## Progress

- 2026-08-26 — TAD drafted after the copy survey (~70 inline
  string sites across 10 modules; InfoSections' explainer is the
  largest single block). Awaiting review.
- 2026-08-26 — TAD merged (PR #35, three lite rounds - two wording
  corrections and the test-coverage nuance above). Extraction PR
  implemented: Lib/Strings.js created; ~70 sites across 10 modules
  now read from it; pure glyphs (✕ ⓘ ▾) stay inline as
  iconography; the full 16-test suite passes UNCHANGED, proving
  the asserted copy byte-identical.
- 2026-08-27 — Decision 8 (self-serve editor page) shipped:
  avastars-editor.html + Lib/StringsEditor.js +
  Lib/StringsMeta.js (76 keys described), deploy.sh copies the
  page, Tests/strings-editor-test.js covers meta coverage both
  ways, plain + template round-trip through a generated module
  import, placeholder-break blocking, and draft persistence
  across reload.
