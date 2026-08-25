// The four effects of docs/tads/burned-traits.md Decision 10.
// Physics assertions read the spring rig's state through
// window.kwigbelleScene (exposed by index.html for this harness)
// instead of guessing from pixels - the underdamped springs decay
// asymptotically, so PNG equality would flake on subpixel motion.
// Isolation: with Motion 0 and Follow 0 the rig settles to rest, so
// any movement an assertion sees comes from the effect under test.
//   Poke  - a quick tap moves an otherwise-static rig, then settles
//   Wave  - animates at Motion 0 (deliberately unscaled), stops off
//   Trails- fade-clearing leaves intermediate-alpha ghosts and
//           skips the backdrop redraw
//   Tilt  - a synthetic deviceorientation event steers the rig
// Plus: layer locks (docs/tads/info-tab.md Decision 4) pin one
// layer against wave/poke/follow, release cleanly, and reset on a
// token swap; and the three toggles persist across a reload.
const { chromium } = require("playwright-core");
const { check } = require("./check.js");

(async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
	page.on("dialog", (d) => {
		errors.push("dialog: " + d.message());
		d.dismiss();
	});

	// testharness=1 exposes window.kwigbelleScene for the physics
	// assertions
	await page.goto(
		"http://localhost:8741/index.html?tokenid=8014&testharness=1",
	);
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.waitForTimeout(500);
	await page.click("#panelHandle");

	// All controls present
	const rows = await page.evaluate(() =>
		[...document.querySelectorAll(".effectRow span")].map((s) => s.textContent),
	);
	console.log("effect rows:", JSON.stringify(rows));
	for (const label of [
		"Pause motion",
		"Motion",
		"Follow",
		"Wave",
		"Trails",
		"Tilt follow",
	]) {
		check(rows.includes(label), `missing effects control: ${label}`);
	}
	check(!rows.includes("Explode"), "retired Explode row present");

	const rigState = () =>
		page.evaluate(() => {
			const springs = window.kwigbelleScene.layerSprings.springs;
			const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
			let maxSpeed = 0;
			let maxOffset = 0;
			let meanDx = 0;
			for (const s of springs) {
				maxSpeed = Math.max(maxSpeed, Math.hypot(s.vx, s.vy));
				maxOffset = Math.max(
					maxOffset,
					Math.hypot(s.x - center.x, s.y - center.y),
				);
				meanDx += s.x - center.x;
			}
			meanDx /= springs.length || 1;
			return { maxSpeed, maxOffset, meanDx, count: springs.length };
		});
	const waitForRest = (label) =>
		page
			.waitForFunction(
				() => {
					const springs = window.kwigbelleScene.layerSprings.springs;
					const center = {
						x: window.innerWidth / 2,
						y: window.innerHeight / 2,
					};
					return springs.every(
						(s) =>
							Math.hypot(s.vx, s.vy) < 0.5 &&
							Math.hypot(s.x - center.x, s.y - center.y) < 1,
					);
				},
				{ timeout: 12000 },
			)
			.catch(() => {
				throw new Error(`rig did not come to rest: ${label}`);
			});
	const setSlider = (name, value) =>
		page.getByRole("slider", { name }).evaluate((slider, v) => {
			slider.value = v;
			slider.dispatchEvent(new Event("input", { bubbles: true }));
			slider.dispatchEvent(new Event("change", { bubbles: true }));
		}, String(value));
	const toggle = (label) =>
		page.locator(".effectRow", { hasText: label }).locator("input");

	// Static baseline: Motion 0 + Follow 0 -> the rig settles to rest
	await setSlider("Motion", 0);
	await setSlider("Follow", 0);
	await waitForRest("baseline at Motion 0 / Follow 0");
	console.log("baseline at rest:", JSON.stringify(await rigState()));

	// WAVE animates the resting rig (unscaled by Motion), stops off
	await toggle("Wave").check();
	await page.waitForFunction(
		() =>
			window.kwigbelleScene.layerSprings.springs.some(
				(s) => Math.hypot(s.vx, s.vy) > 3,
			),
		{ timeout: 5000 },
	);
	console.log("wave moving:", JSON.stringify(await rigState()));
	await toggle("Wave").uncheck();
	await waitForRest("after Wave off");

	// POKE: with Motion 0 AND Follow 0 only the impulse can move
	// layers. Tap left of center, clear of the panel.
	await page.mouse.click(260, 300);
	await page.waitForFunction(
		() =>
			window.kwigbelleScene.layerSprings.springs.some(
				(s) => Math.hypot(s.vx, s.vy) > 60,
			),
		{ timeout: 2000 },
	);
	console.log("poked:", JSON.stringify(await rigState()));
	await waitForRest("settling after poke");

	// A DRAG must not poke: press, move far, release. At Follow 0
	// the drag exerts no force, so any real speed right after the
	// release would be a mis-fired poke impulse.
	await page.mouse.move(260, 300);
	await page.mouse.down();
	await page.mouse.move(420, 340, { steps: 8 });
	await page.waitForTimeout(300);
	await page.mouse.up();
	await page.waitForTimeout(150);
	const afterDrag = await rigState();
	console.log("after drag:", JSON.stringify(afterDrag));
	check(
		afterDrag.maxSpeed < 60,
		`drag fired a poke impulse (maxSpeed ${afterDrag.maxSpeed})`,
	);
	await waitForRest("after drag");

	// TRAILS: ghosts = many intermediate-alpha pixels while moving;
	// the backdrop stops being redrawn (corner fades from opaque)
	const intermediateCount = () =>
		page.evaluate(() => {
			const canvas = document.getElementById("mainCanvas");
			const data = canvas
				.getContext("2d")
				.getImageData(0, 0, canvas.width, canvas.height).data;
			let count = 0;
			for (let i = 3; i < data.length; i += 4) {
				if (data[i] > 8 && data[i] < 247) count++;
			}
			return count;
		});
	const cornerAlpha = () =>
		page.evaluate(() => {
			const canvas = document.getElementById("mainCanvas");
			return canvas.getContext("2d").getImageData(10, 10, 1, 1).data[3];
		});
	// Motion source is a poke (deterministic burst — Wave is a
	// duty-cycled pulse now and could be mid-rest when sampled)
	const cornerBefore = await cornerAlpha();
	check(cornerBefore === 255, "backdrop corner not opaque before trails");
	await page.mouse.click(260, 300);
	await page.waitForTimeout(350);
	const cleanCount = await intermediateCount();
	await waitForRest("clean-motion sample");
	await toggle("Trails").check();
	await page.mouse.click(260, 300);
	await page.waitForTimeout(350);
	const trailsCount = await intermediateCount();
	const cornerAfter = await cornerAlpha();
	console.log(
		`intermediate-alpha pixels: clean=${cleanCount} trails=${trailsCount}; corner alpha ${cornerBefore} -> ${cornerAfter}`,
	);
	check(
		trailsCount > cleanCount * 2 && trailsCount > 5000,
		`trails left no ghosts (${cleanCount} -> ${trailsCount})`,
	);
	check(cornerAfter < 32, "backdrop still painted while Trails on");
	await toggle("Trails").uncheck();
	await page.waitForTimeout(600);
	check(
		(await cornerAlpha()) === 255,
		"backdrop did not return after Trails off",
	);
	await waitForRest("after trails scene");

	// TILT: enable, feed a baseline then a tilted reading; the rig
	// holds a steady offset (Follow drives the reach), and returns
	// to rest at neutral
	await setSlider("Follow", 1);
	await toggle("Tilt follow").check();
	await page.evaluate(() => {
		window.dispatchEvent(
			new DeviceOrientationEvent("deviceorientation", { beta: 40, gamma: 0 }),
		);
		window.dispatchEvent(
			new DeviceOrientationEvent("deviceorientation", { beta: 40, gamma: 18 }),
		);
	});
	await page.waitForFunction(
		() => {
			const springs = window.kwigbelleScene.layerSprings.springs;
			const centerX = window.innerWidth / 2;
			const meanDx =
				springs.reduce((a, s) => a + s.x - centerX, 0) / springs.length;
			return meanDx > 40;
		},
		{ timeout: 5000 },
	);
	console.log("tilted:", JSON.stringify(await rigState()));
	await page.evaluate(() => {
		window.dispatchEvent(
			new DeviceOrientationEvent("deviceorientation", { beta: 40, gamma: 0 }),
		);
	});
	await waitForRest("back at neutral tilt");
	await toggle("Tilt follow").uncheck();

	// LAYER LOCKS (docs/tads/info-tab.md Decision 4): a locked
	// layer's spring pins to center - immobile under wave, poke,
	// and follow while the others move - rejoins when unlocked,
	// and resets on a token swap. The padlocks live on the info
	// drawer's layer cards (one per spring-backed layer; none on
	// the backdrop).
	await setSlider("Follow", 0);
	await waitForRest("before lock scenario");
	await page.click("#infoHandle");
	const lockCount = await page.locator(".traitLock").count();
	const checkboxCount = await page.locator(".traitRow input").count();
	console.log(`locks: ${lockCount}, visibility checkboxes: ${checkboxCount}`);
	check(
		lockCount === checkboxCount - 1,
		`expected a lock per layer card except the backdrop (${lockCount} vs ${checkboxCount})`,
	);
	// Lock the FRONT layer (largest motion = strongest signal)
	await page.locator(".traitLock").last().click();
	check(
		(await page.locator(".traitLock.locked").count()) === 1,
		"lock toggle did not engage",
	);
	const lockedIndex = lockCount - 1;

	// Immobile under WAVE while the others whip
	await page.click("#panelHandle");
	await toggle("Wave").check();
	await page.waitForFunction(
		(locked) => {
			const springs = window.kwigbelleScene.layerSprings.springs;
			const c = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
			const s = springs[locked];
			const still =
				Math.hypot(s.vx, s.vy) < 0.5 && Math.hypot(s.x - c.x, s.y - c.y) < 1;
			const othersMove = springs.some(
				(other, i) => i !== locked && Math.hypot(other.vx, other.vy) > 3,
			);
			return still && othersMove;
		},
		lockedIndex,
		{ timeout: 6000 },
	);
	console.log(
		"locked layer still under wave:",
		JSON.stringify(await rigState()),
	);
	await toggle("Wave").uncheck();
	await waitForRest("after locked wave");

	// No POKE impulse on the locked layer
	await page.mouse.click(260, 300);
	await page.waitForFunction(
		(locked) => {
			const springs = window.kwigbelleScene.layerSprings.springs;
			return springs.some(
				(s, i) => i !== locked && Math.hypot(s.vx, s.vy) > 60,
			);
		},
		lockedIndex,
		{ timeout: 2000 },
	);
	const lockedPokeSpeed = await page.evaluate((locked) => {
		const s = window.kwigbelleScene.layerSprings.springs[locked];
		return Math.hypot(s.vx, s.vy);
	}, lockedIndex);
	console.log("locked layer speed during poke:", lockedPokeSpeed);
	check(
		lockedPokeSpeed < 0.5,
		`locked layer took a poke impulse (speed ${lockedPokeSpeed})`,
	);
	await waitForRest("after locked poke");

	// No FOLLOW reach: hold a drag; the others lean, the locked
	// layer holds center
	await setSlider("Follow", 1);
	await page.mouse.move(420, 300);
	await page.mouse.down();
	await page.waitForFunction(
		(locked) => {
			const springs = window.kwigbelleScene.layerSprings.springs;
			const c = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
			const s = springs[locked];
			const held = Math.hypot(s.x - c.x, s.y - c.y) < 1;
			const othersLean = springs.some(
				(other, i) => i !== locked && other.x - c.x > 15,
			);
			return held && othersLean;
		},
		lockedIndex,
		{ timeout: 5000 },
	);
	console.log("locked layer held during follow");
	await page.mouse.up();
	await setSlider("Follow", 0);
	await waitForRest("after locked follow");

	// REJOIN: unlock and the layer moves with the wave again
	await page.click("#infoHandle");
	await page.locator(".traitLock").last().click();
	check(
		(await page.locator(".traitLock.locked").count()) === 0,
		"lock toggle did not release",
	);
	await page.click("#panelHandle");
	await toggle("Wave").check();
	await page.waitForFunction(
		(locked) => {
			const s = window.kwigbelleScene.layerSprings.springs[locked];
			return Math.hypot(s.vx, s.vy) > 3;
		},
		lockedIndex,
		{ timeout: 6000 },
	);
	console.log("unlocked layer rejoined the wave");
	await toggle("Wave").uncheck();
	await waitForRest("after rejoin");

	// RESET on token swap: lock again, load another token, and both
	// the UI and the scene state come back unlocked
	await page.click("#infoHandle");
	await page.locator(".traitLock").last().click();
	await page.click("#panelHandle");
	await page.fill("#loadTokenInput", "12345");
	await page.press("#loadTokenInput", "Enter");
	await page.waitForFunction(
		() =>
			document.querySelector(".identityTitle")?.textContent ===
				"Avastar #12345" &&
			document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	const afterSwap = await page.evaluate(() => ({
		lockedDom: document.querySelectorAll(".traitLock.locked").length,
		lockedState: window.kwigbelleScene.traitsSection.lockedLayers.size,
	}));
	console.log("locks after token swap:", JSON.stringify(afterSwap));
	check(
		afterSwap.lockedDom === 0 && afterSwap.lockedState === 0,
		"layer locks survived a token swap",
	);

	// PERSISTENCE: set the toggles, reload, expect them restored
	await toggle("Wave").check();
	await toggle("Trails").check();
	await toggle("Tilt follow").check();
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem("kwigbelle.effects")),
	);
	console.log("stored effects:", JSON.stringify(stored));
	check(
		stored.wave === true && stored.trails === true && stored.tilt === true,
		"toggle states not persisted",
	);
	check(!("explode" in stored), "retired explode key still written");
	await page.reload();
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await page.click("#panelHandle");
	const restored = await page.evaluate(() => {
		const state = {};
		for (const row of document.querySelectorAll(".effectRow")) {
			const input = row.querySelector("input[type=checkbox]");
			if (input) state[row.querySelector("span").textContent] = input.checked;
		}
		return state;
	});
	console.log("restored toggles:", JSON.stringify(restored));
	check(restored["Wave"] === true, "Wave not restored");
	check(restored["Trails"] === true, "Trails not restored");
	check(restored["Tilt follow"] === true, "Tilt follow not restored");

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));

	// TOUCH: a real touch tap (which browsers replay as synthetic
	// mouse events) must fire exactly ONE poke — the double-poke
	// regression the review caught. Instrument poke with a counter
	// before tapping.
	const touchContext = await browser.newContext({
		viewport: { width: 800, height: 600 },
		hasTouch: true,
	});
	const touchPage = await touchContext.newPage();
	touchPage.on("pageerror", (e) =>
		errors.push("touch pageerror: " + e.message),
	);
	await touchPage.goto(
		"http://localhost:8741/index.html?tokenid=8014&testharness=1",
	);
	await touchPage.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	await touchPage.waitForTimeout(500);
	await touchPage.evaluate(() => {
		const rig = window.kwigbelleScene.layerSprings;
		window.__pokeCount = 0;
		const original = rig.poke.bind(rig);
		rig.poke = (point) => {
			window.__pokeCount++;
			original(point);
		};
	});
	await touchPage.touchscreen.tap(260, 300);
	// Synthetic mouse replay can lag the touch by a click-delay
	await touchPage.waitForTimeout(900);
	const pokeCount = await touchPage.evaluate(() => window.__pokeCount);
	console.log("touch tap poke count:", pokeCount);
	check(pokeCount === 1, `touch tap fired ${pokeCount} pokes (expected 1)`);
	check(errors.length === 0, "touch page errors: " + JSON.stringify(errors));
	await touchContext.close();
	await browser.close();
})();
