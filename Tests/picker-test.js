// Profile drawer grid (docs/tads/profile-drawer.md): the owned
// Avastars live in the profile drawer now — the old floating picker
// is gone. Silent connect builds the grid and lights the handle
// badge; opening the drawer loads thumbnails lazily; picking a tile
// loads that token, closes the drawer, and moves the highlight.
const { chromium } = require("playwright-core");
const { check, strings } = require("./check.js");

const MOCK_PROVIDER = `
window.__ownedIds = [8014, 25495, 25470];
window.__renderCalls = 0;
window.ethereum = {
	isMetaMask: true,
	on: () => {},
	removeListener: () => {},
	request: async ({ method, params }) => {
		if (method === "eth_accounts" || method === "eth_requestAccounts") {
			return ["0x1111111111111111111111111111111111111111"];
		}
		if (method === "eth_chainId") return "0x1";
		if (method === "net_version") return "1";
		if (method === "eth_blockNumber") return "0x1";
		if (method === "eth_call") {
			const w3 = new Web3();
			const abi = w3.eth.abi;
			const data = params[0].data;
			const sel = data.slice(0, 10);
			const sig = (s) => abi.encodeFunctionSignature(s);
			if (sel === sig("balanceOf(address)")) {
				return abi.encodeParameter("uint256", window.__ownedIds.length);
			}
			if (sel === sig("tokenOfOwnerByIndex(address,uint256)")) {
				const index = parseInt(data.slice(-64), 16);
				return abi.encodeParameter("uint256", window.__ownedIds[index]);
			}
			if (sel === sig("renderAvastar(uint256)")) {
				window.__renderCalls++;
				const id = parseInt(data.slice(-64), 16);
				const res = await fetch("/SVG/Avastar-" + id + ".svg");
				if (!res.ok) throw new Error("no svg for " + id);
				return abi.encodeParameter("string", await res.text());
			}
			throw new Error("unmocked eth_call selector " + sel);
		}
		throw new Error("unmocked method " + method);
	},
};
`;

(async () => {
	const Strings = strings();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
	page.on("console", (m) => {
		if (m.type() === "error") errors.push("console: " + m.text());
	});
	page.on("dialog", (d) => {
		errors.push("dialog: " + d.message());
		d.dismiss();
	});
	await page.addInitScript(MOCK_PROVIDER);

	// The 3D section's backup indicator HEADs vrm/<file>; the test
	// server has no mirror, so answer 200 to keep the console clean
	await page.route("https://kwigbelle.com/vrm/Avastar_*.vrm", (route) =>
		route.fulfill({ status: 200, body: "" }),
	);
	await page.goto("http://localhost:8741/index.html");
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	// The silent wallet flow builds the grid (no drawer interaction
	// needed) and auto-swaps to the first owned Avastar
	// (the display starts on a random bundled token, so the
	// highlight settles on 8014 only once the silent swap lands)
	await page.waitForFunction(
		() =>
			document.querySelectorAll("#profileGrid .profileCard").length === 3 &&
			document.getElementById("preloader")?.style.opacity === "0" &&
			document.querySelector(".profileCard.current")?.dataset.token === "8014",
		{ timeout: 20000 },
	);

	const closed = await page.evaluate(() => ({
		oldPicker: !!document.getElementById("avastarPicker"),
		drawerOpen: document.getElementById("sidePanel").classList.contains("open"),
		badge: document
			.getElementById("profileHandle")
			.classList.contains("connected"),
		// Lazy thumbnails: no wallet renders before the drawer opens
		thumbs: document.querySelectorAll("#profileGrid img").length,
		currentLabel: document.querySelector(".profileCard.current").dataset.token,
	}));
	console.log("before open:", JSON.stringify(closed));
	// The handle carries the always-visible presence dot
	check(
		await page.evaluate(() =>
			document.getElementById("profileHandle").classList.contains("statusDot"),
		),
		"profile handle missing the status dot",
	);
	check(!closed.oldPicker, "retired floating picker still present");
	check(!closed.drawerOpen, "drawer open before any tap");
	check(closed.badge, "profile handle badge not lit after silent connect");
	check(closed.thumbs === 0, "thumbnails rendered before the drawer opened");
	check(
		closed.currentLabel === "8014",
		"current highlight not on the first owned token: " + closed.currentLabel,
	);

	// Open the profile drawer: thumbnails render in
	await page.click("#profileHandle");
	const opened = await page.evaluate(() => ({
		drawerOpen: document.getElementById("sidePanel").classList.contains("open"),
		profileActive: document
			.getElementById("profileHandle")
			.classList.contains("active"),
	}));
	check(opened.drawerOpen, "profile handle did not open the drawer");
	check(opened.profileActive, "profile handle not marked active");
	await page.waitForFunction(
		() => document.querySelectorAll("#profileGrid img").length === 3,
		{ timeout: 15000 },
	);
	const address = await page.evaluate(
		() => document.getElementById("profileAddress")?.innerText,
	);
	console.log("address line:", JSON.stringify(address));
	check(
		!!address && address.includes("…"),
		"connected address line missing: " + address,
	);
	// Thumbnails compose from the library: ZERO on-chain renders
	// (docs/tads/profile-drawer.md Decision 9)
	const renderCalls = await page.evaluate(() => window.__renderCalls);
	console.log("renderAvastar calls:", renderCalls);
	check(
		renderCalls === 0,
		"thumbnails hit the chain render RPC " + renderCalls + "x",
	);
	await page.screenshot({ path: "profile-open.png" });

	// Trading cards (docs/tads/wallet-cards.md): tier frame + stat
	// strip fill from the local corpus. 8014: score 36 Uncommon
	// (#2ECC71), female prime S2. 25470: score 45 Rare (#F5A623),
	// gender-0 replicant -> Non-binary, never a blank.
	const cardFront = (token) =>
		page.evaluate((id) => {
			const card = document.querySelector(`.profileCard[data-token="${id}"]`);
			const front = card.querySelector(".cardFront");
			return {
				id: card.querySelector(".cardId").innerText,
				// textContent: the kind line is CSS-uppercased
				kind: card.querySelector(".cardKind").textContent,
				stats: card.querySelector(".cardStatLine").innerText,
				frame: getComputedStyle(front).borderColor,
				icons: card.querySelectorAll(".cardStatLine .rarityIcon").length,
				loadButtons: card.querySelectorAll(".cardLoad").length,
			};
		}, String(token));
	await page.waitForFunction(
		() =>
			[...document.querySelectorAll(".cardStatLine")].every(
				(line) => line.innerText.length > 0,
			),
		{ timeout: 15000 },
	);
	const front8014 = await cardFront(8014);
	const front25470 = await cardFront(25470);
	console.log("card fronts:", JSON.stringify({ front8014, front25470 }));
	check(front8014.id === "#8014", "card id wrong: " + front8014.id);
	check(
		front8014.stats === "36 · Female · " + Strings.cards.series(2),
		"8014 stat strip wrong: " + front8014.stats,
	);
	check(
		front8014.frame === "rgb(46, 204, 113)",
		"8014 tier frame not Uncommon green: " + front8014.frame,
	);
	check(front8014.icons === 1, "stat strip missing its tier icon");
	// No Load button (operator QA): the whole front is the tap
	check(front8014.loadButtons === 0, "the retired Load button is back");
	check(front8014.kind === "", "prime card carries a kind line");
	check(
		front25470.stats === "45 · Non-binary",
		"gender-0 replicant strip wrong: " + front25470.stats,
	);
	// Special kinds get their own louder line (operator QA)
	check(
		front25470.kind === "Replicant",
		"replicant kind line wrong: " + front25470.kind,
	);
	check(
		front25470.frame === "rgb(245, 166, 35)",
		"25470 tier frame not Rare amber: " + front25470.frame,
	);

	// Flip 8014: the back builds lazily with the identity facts
	// (zero burns -> mint condition, UB anchors u2=1/u3=41, the
	// frozen minter as an etherscan link)
	const minters = require("../Tools/data/minters.json");
	const minter8014 = minters.addresses[minters.minterIndex["8014"]];
	await page
		.locator('.profileCard[data-token="8014"] .cardFront .cardFlip')
		.click();
	await page.waitForFunction(
		(expected) =>
			document.querySelector('.profileCard[data-token="8014"] .cardBackTitle')
				?.innerText === expected &&
			!!document.querySelector('.profileCard[data-token="8014"] .cardMinter'),
		Strings.traits.identityTitle(8014),
		{ timeout: 15000 },
	);
	const back8014 = await page.evaluate(() => {
		const card = document.querySelector('.profileCard[data-token="8014"]');
		return {
			flipped: card.classList.contains("flipped"),
			lines: [...card.querySelectorAll(".cardBackLine")].map(
				(line) => line.innerText,
			),
			traits: [...card.querySelectorAll(".cardTraitRow")].map(
				(row) => row.innerText,
			),
			traitIcons: card.querySelectorAll(".cardTraitRow .rarityIcon").length,
			minter: card.querySelector(".cardMinter").innerText,
			minterHref: card.querySelector(".cardMinter").href,
		};
	});
	console.log("8014 back:", JSON.stringify(back8014));
	check(back8014.flipped, "flip affordance did not flip the card");
	// Vertical pages (operator QA): facts page + two trait pages,
	// a real <button> pager cycling with wrap, aria-live announced
	const readPager = () =>
		page.evaluate(() => {
			const card = document.querySelector('.profileCard[data-token="8014"]');
			const pages = [...card.querySelectorAll(".cardBackPage")];
			const active = pages.findIndex((p) => p.classList.contains("active"));
			return {
				count: pages.length,
				active,
				ariaHidden: pages.map((p) => p.getAttribute("aria-hidden")),
				liveRegion: card
					.querySelector(".cardBackPages")
					.getAttribute("aria-live"),
				pagerTag: card.querySelector(".cardPagerNext").tagName,
				pagerLabel: card
					.querySelector(".cardPagerNext")
					.getAttribute("aria-label"),
				pagerText: card.querySelector(".cardPagerNext").innerText,
				prevTag: card.querySelector(".cardPagerPrev").tagName,
				prevLabel: card
					.querySelector(".cardPagerPrev")
					.getAttribute("aria-label"),
				pageNum: card.querySelector(".cardPageNum").innerText,
				activeTraitRows: pages[active]
					? pages[active].querySelectorAll(".cardTraitRow").length
					: -1,
			};
		});
	const page1 = await readPager();
	console.log("pager:", JSON.stringify(page1));
	check(
		page1.count === 3 && page1.active === 0 && page1.activeTraitRows === 0,
		"back pages wrong: " + JSON.stringify(page1),
	);
	check(
		page1.pagerTag === "BUTTON" &&
			page1.prevTag === "BUTTON" &&
			page1.prevLabel === Strings.cards.prevPage &&
			page1.pagerLabel === Strings.cards.nextPage &&
			page1.pagerText === "▸" &&
			page1.liveRegion === "polite" &&
			page1.pageNum === "1 / 3" &&
			JSON.stringify(page1.ariaHidden) ===
				JSON.stringify(["false", "true", "true"]),
		"pager accessibility wrong: " + JSON.stringify(page1),
	);
	await page.locator('.profileCard[data-token="8014"] .cardPagerNext').click();
	const page2 = await readPager();
	check(
		page2.active === 1 &&
			page2.activeTraitRows === 6 &&
			page2.pageNum === "2 / 3",
		"Next Page did not advance: " + JSON.stringify(page2),
	);
	await page.locator('.profileCard[data-token="8014"] .cardPagerNext').click();
	await page.locator('.profileCard[data-token="8014"] .cardPagerNext').click();
	const wrapped = await readPager();
	check(
		wrapped.active === 0 && wrapped.pageNum === "1 / 3",
		"pager did not wrap home: " + JSON.stringify(wrapped),
	);
	// Back-and-forth (operator QA): ◂ from page 1 wraps to the
	// last page, then steps backward normally
	await page.locator('.profileCard[data-token="8014"] .cardPagerPrev').click();
	const back3 = await readPager();
	check(
		back3.active === 2 && back3.pageNum === "3 / 3",
		"prev did not wrap to the last page: " + JSON.stringify(back3),
	);
	await page.locator('.profileCard[data-token="8014"] .cardPagerPrev').click();
	check((await readPager()).active === 1, "prev did not step backward");
	// Full trait list (operator QA): all 12, gene-ordered, each
	// with a tier icon; 8014's gene 0 is Mellow Apricot
	check(
		back8014.traits.length === 12 && back8014.traitIcons === 12,
		"back trait list wrong: " + JSON.stringify(back8014.traits),
	);
	check(
		back8014.traits[0] === "Mellow Apricot" &&
			back8014.traits[11] === "Pigtails",
		"trait rows out of gene order: " + JSON.stringify(back8014.traits),
	);
	check(
		back8014.lines.includes(Strings.traits.score(36, "Uncommon")),
		"back missing the score line: " + JSON.stringify(back8014.lines),
	);
	check(
		back8014.lines.includes("Female · Prime · " + Strings.traits.series(2)),
		"back missing the facts line: " + JSON.stringify(back8014.lines),
	);
	check(
		back8014.lines.includes(Strings.traits.mintCondition),
		"back missing mint condition: " + JSON.stringify(back8014.lines),
	);
	check(
		back8014.lines.includes(Strings.traits.uniqueByCombos(1, 41)),
		"back missing the UB line: " + JSON.stringify(back8014.lines),
	);
	check(
		back8014.minter ===
			Strings.traits.mintedBy(
				minter8014.slice(0, 6) + "…" + minter8014.slice(-4),
			) && back8014.minterHref === "https://etherscan.io/address/" + minter8014,
		"back minter link wrong: " + JSON.stringify(back8014),
	);

	// One card at a time: flipping 25470 flips 8014 home; the ✕ on
	// the back flips the last one home too
	await page
		.locator('.profileCard[data-token="25470"] .cardFront .cardFlip')
		.click();
	await page.waitForFunction(
		() =>
			document.querySelectorAll(".profileCard.flipped").length === 1 &&
			document
				.querySelector('.profileCard[data-token="25470"]')
				.classList.contains("flipped"),
		{ timeout: 5000 },
	);
	await page
		.locator('.profileCard[data-token="25470"] .cardBack .cardFlip')
		.click();
	await page.waitForFunction(
		() => document.querySelectorAll(".profileCard.flipped").length === 0,
		{ timeout: 5000 },
	);
	console.log("flip discipline holds");

	// Pick the second Avastar: loads it and moves
	// the highlight
	await page.locator("#profileGrid .profileCard").nth(1).click();
	// The drawer stays OPEN across a pick (operator QA 2026-08-28)
	await page.waitForFunction(
		() =>
			document.getElementById("preloader")?.style.opacity === "0" &&
			document.querySelector(".profileCard.current")?.dataset.token !== "8014",
		{ timeout: 15000 },
	);
	check(
		await page.evaluate(() =>
			document.getElementById("sidePanel").classList.contains("open"),
		),
		"picking an owned Avastar closed the drawer",
	);
	await page.waitForTimeout(500);
	const picked = await page.evaluate(() => ({
		current: document.querySelector(".profileCard.current")?.dataset.token,
		currents: document.querySelectorAll(".profileCard.current").length,
	}));
	console.log("picked:", JSON.stringify(picked));
	check(
		picked.current === "25495",
		"highlight did not move to the picked token: " + picked.current,
	);
	check(picked.currents === 1, "more than one tile highlighted");
	await page.screenshot({ path: "profile-picked.png" });

	// Tapping the art itself picks too (and the drawer stays open)
	await page.locator('.profileCard[data-token="25470"] .cardArt').click();
	await page.waitForFunction(
		() =>
			document.getElementById("preloader")?.style.opacity === "0" &&
			document.querySelector(".profileCard.current")?.dataset.token === "25470",
		{ timeout: 15000 },
	);
	check(
		await page.evaluate(() =>
			document.getElementById("sidePanel").classList.contains("open"),
		),
		"art-tap pick closed the drawer",
	);

	// Filter (operator QA): free text over trait names, ids, kind,
	// tier, gender. Toothpick is 8014's mouth and unique in this
	// wallet (25470 shares Pigtails - replicants borrow prime
	// traits); both replicants match "replicant"; clearing
	// restores all three.
	const visibleCards = () =>
		page.evaluate(() =>
			[...document.querySelectorAll(".profileCard")]
				.filter((card) => card.style.display !== "none")
				.map((card) => card.dataset.token),
		);
	check(
		await page.evaluate(
			(expected) =>
				document.querySelector(".cardFilter")?.placeholder === expected,
			Strings.cards.filter,
		),
		"filter placeholder wrong",
	);
	await page.locator(".cardFilter").fill("toothpick");
	await page.waitForFunction(
		() =>
			[...document.querySelectorAll(".profileCard")].filter(
				(card) => card.style.display !== "none",
			).length === 1,
		{ timeout: 10000 },
	);
	check(
		JSON.stringify(await visibleCards()) === JSON.stringify(["8014"]),
		"trait filter wrong: " + JSON.stringify(await visibleCards()),
	);
	await page.locator(".cardFilter").fill("replicant");
	await page.waitForFunction(
		() =>
			[...document.querySelectorAll(".profileCard")].filter(
				(card) => card.style.display !== "none",
			).length === 2,
		{ timeout: 10000 },
	);
	check(
		JSON.stringify(await visibleCards()) === JSON.stringify(["25495", "25470"]),
		"kind filter wrong: " + JSON.stringify(await visibleCards()),
	);
	await page.locator(".cardFilter").fill("");
	await page.waitForFunction(
		() =>
			[...document.querySelectorAll(".profileCard")].filter(
				(card) => card.style.display !== "none",
			).length === 3,
		{ timeout: 10000 },
	);
	console.log("card filter holds");

	// Log out: the drawer returns to Link Wallet, the badge and
	// grid clear, and the choice persists
	await page.click("#profileHandle");
	await page.waitForSelector(".profileLogout", { timeout: 5000 });
	await page.click(".profileLogout");
	const loggedOut = await page.evaluate(() => ({
		button: document.querySelector(".connectButton")?.innerText || null,
		badge: document
			.getElementById("profileHandle")
			.classList.contains("connected"),
		tiles: document.querySelectorAll("#profileGrid .profileCard").length,
		stored: localStorage.getItem("kwigbelle.wallet"),
		flag: localStorage.getItem("kwigbelle.disconnected"),
	}));
	console.log("logged out:", JSON.stringify(loggedOut));
	check(
		loggedOut.button === Strings.profile.linkWallet,
		"logout did not restore the connect button: " + loggedOut.button,
	);
	check(!loggedOut.badge, "handle badge still lit after logout");
	check(loggedOut.tiles === 0, "grid not cleared by logout");
	check(loggedOut.stored === null, "remembered wallet survived logout");
	check(loggedOut.flag === "1", "logout flag not persisted");

	// A reload stays logged out: no silent reconnect
	await page.reload();
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.waitForTimeout(800);
	const afterReload = await page.evaluate(() => ({
		tiles: document.querySelectorAll("#profileGrid .profileCard").length,
		badge: document
			.getElementById("profileHandle")
			.classList.contains("connected"),
	}));
	console.log("after logged-out reload:", JSON.stringify(afterReload));
	check(afterReload.tiles === 0, "silent reconnect after logout");
	check(!afterReload.badge, "badge lit after logged-out reload");

	// Link Wallet ends the logged-out state and reconnects (the
	// reconnect loads the first owned token, so the highlight lands
	// on it via finishLoad)
	await page.click("#profileHandle");
	await page.waitForSelector(".connectButton", { timeout: 5000 });
	await page.click(".connectButton");
	await page.waitForFunction(
		() =>
			document.querySelectorAll("#profileGrid .profileCard").length === 3 &&
			document
				.getElementById("profileHandle")
				.classList.contains("connected") &&
			document.querySelector(".profileCard.current")?.dataset.token ===
				"8014" &&
			document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 20000 },
	);
	console.log("reconnected after logout");

	// Logout/reconnect while the DISPLAYED token is already the
	// first owned one: the reconnect's same-token load
	// short-circuits (no finishLoad), so the highlight must survive
	// from the preserved currentTokenId
	await page.click(".profileLogout");
	await page.waitForSelector(".connectButton", { timeout: 5000 });
	await page.click(".connectButton");
	await page.waitForFunction(
		() =>
			document.querySelectorAll("#profileGrid .profileCard").length === 3 &&
			document.querySelector(".profileCard.current")?.dataset.token === "8014",
		{ timeout: 20000 },
	);
	console.log("same-token reconnect keeps the highlight");

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
