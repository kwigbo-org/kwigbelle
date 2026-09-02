# TAD: Wallet trading cards — the owned grid becomes card tiles

- **Status:** COMPLETE (2026-09-01, PR #54)
- **Driver:** Operator (2026-09-01): "improved wallet avastars with
  tiles and details. trading card looking with stats. main
  illustrative stats on front with a load button. Info icon with
  full details on the card back. flip transitions." Plus "Genders
  are missing" — gender exists in the corpus but is shown nowhere.

## Context

- The profile drawer's owned grid (docs/tads/profile-drawer.md) is
  a plain thumbnail grid: lazy library-composed thumbnails, token
  id labels, whole-tile tap = load, a `current` highlight. All of
  it lives in `ProfileSection.buildGrid`.
- Every stat a card could show is already committed and local — no
  wallet or chain calls: `hashes.json` (kind, series, ranking →
  score/tier, gender), `ub.json` (Unique-By counts), `burned.json`
  (burn masks), `minters.json` (original minter).
  `TraitComposer.tokenInfo` already returns kind/series/ranking/
  gender; `ubFor`/`burnedFor`/`minterFor` cover the rest.
- Gender is stored per token (contract enum: 0 = any / 1 = male /
  2 = female — 697 tokens are gender 0) and drives the trait
  chooser's filter, but no display surface renders it — not the
  identity card, not the grid.
- The identity card in the info drawer (TraitsSection) already
  composes chips, score/tier, minter link, Unique-By, burn state —
  the card BACK is largely that content restyled.
- `RarityIcons.js` is the single design-token source for tier
  icons/colors and kind labels; tier-tinted outlines are already
  house style on the trait cards (the identity card keeps a
  neutral border today — the trading card's tier frame is new,
  tinted by the TOKEN's tier the way trait cards tint by trait
  tier).

## Decisions

1. **Card anatomy — front.** Each owned Avastar renders as a
   trading-card tile: the composed art fills the card, a
   tier-colored frame (the same `RarityIcons` tint used on trait
   cards), and a compact stat strip: `#id`, score + tier icon,
   gender, series (or kind chip for non-primes). One **Load**
   button. The lazy thumbnail pipeline is reused as-is — the art
   is the existing composed thumbnail, just framed.
2. **Card back — the ⓘ flip.** An ⓘ icon on the front flips the
   card to a details back: score/tier line, gender, series/kind,
   mint-condition or burned-count line, Unique-By line, and the
   minter (etherscan link, same rules as the identity card). Back
   content builds lazily on first flip (the lookups are async but
   local). If the minimal-uniqueness line ships (pending product
   owner decision), the back picks it up for free by reusing the
   identity-card renderers.
3. **Flip transition.** CSS 3D flip (`rotateY` with
   `preserve-3d`, backface-visibility hidden). Under
   `prefers-reduced-motion: reduce` the flip is an instant
   face swap — the site already honors that media query. At most
   one card is flipped at a time: flipping one flips any other
   back, so the grid never becomes a wall of backs.
4. **Tap semantics.** The Load button loads the token and the
   drawer STAYS OPEN (the standing operator QA rule for picks).
   A tap on the front face outside ⓘ also loads — that preserves
   today's whole-tile behavior so muscle memory keeps working. On
   the back, ⓘ (now ✕-styled) flips home; taps on back content do
   not load (links like the minter must be clickable).
5. **Gender display fix, site-wide.** Gender also joins the
   identity card in the info drawer as a chip (e.g. "Female") —
   the "genders are missing" gap closes on both surfaces. Label
   map (0 → Any, 1 → Male, 2 → Female) lives in `RarityIcons.js`
   beside the kind labels — collection vocabulary at its
   design-token source, per the strings TAD's editorial-copy
   boundary. Gender 0 is a real collection fact (697 tokens), so
   it renders as "Any" everywhere the label appears — no surface
   ever shows a blank.
6. **All card copy via Strings.js.** Every new editorial label
   (the Load button text, back-face field labels, the flip
   affordance tooltip) is born in `Strings.js` + `StringsMeta.js`
   so the content editor owns card copy from day one.
7. **Strings-tax prerequisite.** Before (or with) this feature,
   the test suite stops hardcoding UI copy: tests import
   `Strings.js` and assert against the keys, so editor passes and
   this feature's new strings never trigger a test-churn sweep.
   Ships as its own test-only PR.
8. **No new data, no new fetches.** The cards render entirely
   from the committed corpus files and the composed-thumbnail
   pipeline. Wallet interaction is unchanged (connect /
   enumerate / logout); presence dot, badges, and the chooser are
   untouched.

## Open questions (operator)

- Front stat strip: score + tier icon + gender + series proposed —
  trim or add (e.g. burn count on the front)?
- Card size: today's grid fits ~3 across on desktop; trading-card
  proportions (2.5:3.5) will make tiles taller — is ~2 across on
  mobile acceptable?

## Testing

- Grid renders cards with tier frames + stat strips (Strings-key
  assertions, not literals).
- ⓘ flips: back face content (score, gender, minter link), one
  flipped card at a time, reduced-motion instant swap.
- Load from card front + Load button: token loads, drawer stays
  open, `current` highlight moves.
- Identity card gender chip renders for a known token, and a
  gender-0 token shows "Any" (never a blank).
- Existing picker/profile tests keep passing (connect, logout,
  thumbnails, badge).

## Progress

- 2026-09-01: TAD drafted (this document).
- 2026-09-01: TAD merged (PR #52) with two review corrections:
  the gender enum includes 0 (697 tokens, all replicants) and
  tier outlines were trait-card-only house style.
- 2026-09-01: Shipped (PR #54) after a live stage-QA arc that
  revised the TAD's shape in places - deviations recorded here as
  the historical record:
  - Gender 0 reads "Non-binary", not "Any" (operator decision).
  - No Load button: the whole card front is the tap-to-load
    surface; the ⓘ (the info tab's solid icon in a 3px-ring chip)
    floats over the art corner.
  - Front details center-aligned; Founder/Exclusive/Replicant get
    their own uppercase kind line; primes show S<n> in the strip.
  - The back is vertical PAGES (facts, then traits six per page)
    with arrow-only ◂/▸ nav wrapping both ways - aria-live pages,
    real buttons, "Next Page"/"Previous Page" as accessible
    labels. Scroll-more was tried and replaced.
  - A free-text filter above the cards (logged-in surface only)
    matches trait names, gene names, id, kind, gender, tier,
    score, and S<n>.
  - Strings-tax prerequisite shipped first (PR #53): tests assert
    Strings keys, so none of the copy churn above touched tests.
