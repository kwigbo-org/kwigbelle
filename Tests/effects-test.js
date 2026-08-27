// The four effects of docs/tads/burned-traits.md Decision 10.
// Physics assertions read the spring rig's state through
// window.kwigbelleScene (exposed by index.html for this harness)
// instead of guessing from pixels - the underdamped springs decay
// asymptotically, so PNG equality would flake on subpixel motion.
// Isolation: with Motion 0 and Follow 0 the rig settles to rest, so
// any movement an assertion sees comes from the effect under test.
//   Poke  - a quick tap moves an otherwise-static rig, then settles
//   Wave  - animates at Motion 0 (deliberately unscaled), stops off
//   Trails- fade-clearing leaves intermediate-alpha ghosts on the
//           layer canvas; the backdrop canvas stays fully painted
//   Tilt  - a synthetic deviceorientation event steers the rig
// Plus: Lock layers (docs/tads/info-tab.md Decision 4) converges
// a drag into moving the face as one piece where an unlocked drag
// spreads it by depth; and the toggles persist across a reload.
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
	// The backup indicator probes the absolute mirror URL; answer
	// locally so no test touches the real network
	await page.route("**/vrm/Avastar_*.vrm", (route) =>
		route.fulfill({ status: 200, body: "" }),
	);
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
		"Lock layers",
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

	// Lock layers ships ON (operator QA): a fresh visitor's drag
	// moves the face as one piece until they opt out
	check(
		await toggle("Lock layers").isChecked(),
		"Lock layers should default ON",
	);

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

	// TRAILS: ghosts = many intermediate-alpha pixels on the layer
	// canvas while moving; the backdrop lives on its OWN canvas and
	// must stay fully visible throughout (operator QA - the old
	// skip-the-backdrop behavior obscured the art)
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
			const canvas = document.getElementById("backdropCanvas");
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
	check(cornerAfter === 255, "backdrop obscured while Trails on");
	await toggle("Trails").uncheck();
	await page.waitForTimeout(600);
	check((await cornerAlpha()) === 255, "backdrop did not survive Trails off");
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

	// LOCK LAYERS (docs/tads/info-tab.md Decision 4): dragging with
	// the toggle off separates the layers by depth-scaled reach;
	// with it on, every spring runs the same mid-depth profile and
	// the face converges into moving as ONE piece.
	// In-page helper installed once: x-spread of the stack and its
	// mean lean from center
	await page.evaluate(() => {
		window.__stackSpread = () => {
			const xs = window.kwigbelleScene.layerSprings.springs.map((s) => s.x);
			const centerX = window.innerWidth / 2;
			return {
				spread: Math.max(...xs) - Math.min(...xs),
				meanDx: xs.reduce((a, x) => a + x - centerX, 0) / xs.length,
			};
		};
	});
	// Locked drag-hold far left (the DEFAULT state): the layers
	// stay in lockstep while following the pointer
	await page.mouse.move(200, 300);
	await page.mouse.down();
	await page.waitForFunction(
		() => {
			const { spread, meanDx } = window.__stackSpread();
			return spread < 2 && meanDx < -100;
		},
		{ timeout: 8000 },
	);
	console.log(
		"locked (default) drag moves the face as one piece:",
		JSON.stringify(await page.evaluate(() => window.__stackSpread())),
	);
	await page.mouse.up();
	await waitForRest("after locked drag");

	// Opt out and hold the same drag: the stack spreads by depth
	await toggle("Lock layers").uncheck();
	await page.mouse.move(200, 300);
	await page.mouse.down();
	await page.waitForFunction(
		() => {
			const { spread, meanDx } = window.__stackSpread();
			return spread > 30 && meanDx < -100;
		},
		{ timeout: 5000 },
	);
	console.log(
		"unlocked drag spreads the stack:",
		JSON.stringify(await page.evaluate(() => window.__stackSpread())),
	);
	await page.mouse.up();
	await waitForRest("after unlocked drag");
	await setSlider("Follow", 0);

	// PERSISTENCE: set the toggles, reload, expect them restored
	await toggle("Lock layers").check();
	await toggle("Wave").check();
	await toggle("Trails").check();
	await toggle("Tilt follow").check();
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem("kwigbelle.effects")),
	);
	console.log("stored effects:", JSON.stringify(stored));
	check(
		stored.lockLayers === true &&
			stored.wave === true &&
			stored.trails === true &&
			stored.tilt === true,
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
	check(restored["Lock layers"] === true, "Lock layers not restored");
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
