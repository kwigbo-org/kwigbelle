// Pinch-to-zoom (docs/tads/pinch-zoom.md Decision 7): the zoom is
// an ACTUAL vector zoom - the settled re-raster swaps in layer
// images rebuilt from SVG at the zoomed scale - not a page zoom.
// Assertions ride window.kwigbelleScene (?testharness):
//   (a) wheel zoom changes the scale, and the listener
//       preventDefaults (the browser page-zoom suppression)
//   (b) the scale clamps at 4x
//   (c) the settled re-raster swapped in higher-resolution layers
//   (d) a drag pans within the clamp bounds
//   (e) double-tap glides back to 1x (and both taps still poke)
//   (f) a synthetic two-finger pinch zooms, and its multi-touch
//       touchmove is cancelled
//   (g) a token load resets the zoom and the raster scale
const { chromium } = require("playwright-core");
const { check } = require("./check.js");

(async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const context = await browser.newContext({
		viewport: { width: 800, height: 600 },
		hasTouch: true,
	});
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
	page.on("dialog", (d) => {
		errors.push("dialog: " + d.message());
		d.dismiss();
	});

	// The backup indicator probes the absolute mirror URL; answer
	// locally so no test touches the real network
	await page.route("https://kwigbelle.com/vrm/Avastar_*.vrm", (route) =>
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

	const zoomState = () =>
		page.evaluate(() => {
			const scene = window.kwigbelleScene;
			return {
				scale: scene.zoomView.scale,
				tx: scene.zoomView.tx,
				ty: scene.zoomView.ty,
				rasterScale: scene.avastar.rasterScale || 1,
				layerWidth: scene.avastar.layers[0].width,
				canvasWidth: scene.canvas.width,
			};
		});
	// Wheel events dispatch on the HIT-TESTED element at the
	// cursor, exactly like a real wheel - a canvas-targeted
	// dispatch masked the launch bug where the hit-testable
	// preloader swallowed center-screen wheel events
	const wheel = (deltaY, x, y) =>
		page.evaluate(
			([dy, cx, cy]) =>
				document.elementFromPoint(cx, cy).dispatchEvent(
					new WheelEvent("wheel", {
						deltaY: dy,
						clientX: cx,
						clientY: cy,
						cancelable: true,
						bubbles: true,
					}),
				),
			[deltaY, x, y],
		);

	// (a) Wheel zoom: scale rises, default is prevented. First the
	// dead-zone guard: center screen must hit-test to the canvas
	// (the preloader is pointer-events: none), so touch
	// suppression and gestures land on the scene everywhere.
	const centerTarget = await page.evaluate(
		() => document.elementFromPoint(400, 300).id,
	);
	check(
		centerTarget === "mainCanvas",
		"center screen hit-tests to " + centerTarget + ", not the canvas",
	);
	const before = await zoomState();
	check(before.scale === 1, "scene did not start at 1x: " + before.scale);
	check(before.layerWidth === 800, "base raster not canvas-sized");
	const notPrevented = await wheel(-400, 400, 300);
	const zoomed = await zoomState();
	console.log("after wheel:", JSON.stringify(zoomed));
	check(
		notPrevented === false,
		"wheel listener did not preventDefault (browser page zoom not suppressed)",
	);
	check(zoomed.scale > 1.5, "wheel did not zoom in: " + zoomed.scale);

	// Decision 8 scoping: wheel over the drawer stack is left to
	// native scrolling - not prevented, no zoom change
	const drawerWheel = await page.evaluate(() =>
		document.getElementById("sidePanel").dispatchEvent(
			new WheelEvent("wheel", {
				deltaY: -400,
				clientX: 795,
				clientY: 300,
				cancelable: true,
				bubbles: true,
			}),
		),
	);
	const afterDrawerWheel = await zoomState();
	check(
		drawerWheel === true,
		"wheel over the drawer was preventDefaulted (native scroll broken)",
	);
	check(
		afterDrawerWheel.scale === zoomed.scale,
		"wheel over the drawer changed the zoom",
	);

	// (b) Clamp: keep zooming, the scale stops at 4
	for (let i = 0; i < 12; i++) {
		await wheel(-600, 400, 300);
	}
	const clamped = await zoomState();
	console.log("clamped:", JSON.stringify(clamped));
	check(clamped.scale === 4, "zoom did not clamp at 4x: " + clamped.scale);

	// (c) The settled re-raster: layers rebuild from SVG at 4x
	// (800x600 viewport, so 3200px stays under the 4096 cap)
	await page.waitForFunction(
		() =>
			(window.kwigbelleScene.avastar.rasterScale || 1) === 4 &&
			window.kwigbelleScene.avastar.layers[0].width === 3200,
		{ timeout: 8000 },
	);
	console.log("re-raster landed:", JSON.stringify(await zoomState()));

	// (d) Drag pans, and the pan clamps to the content bounds
	// (scale 4 on an 800x600 canvas: tx in [-2400, 0], ty in
	// [-1800, 0])
	const panBefore = await zoomState();
	await page.mouse.move(400, 300);
	await page.mouse.down();
	await page.mouse.move(700, 500, { steps: 6 });
	await page.mouse.up();
	const panned = await zoomState();
	console.log("panned:", JSON.stringify(panned));
	check(
		panned.tx !== panBefore.tx || panned.ty !== panBefore.ty,
		"drag did not pan while zoomed",
	);
	await page.mouse.move(400, 300);
	await page.mouse.down();
	await page.mouse.move(20, 20, { steps: 4 });
	await page.mouse.move(790, 590, { steps: 4 });
	for (let i = 0; i < 4; i++) {
		await page.mouse.move(20, 20, { steps: 4 });
		await page.mouse.move(790, 590, { steps: 4 });
	}
	await page.mouse.up();
	const bounds = await zoomState();
	console.log("after wild drag:", JSON.stringify(bounds));
	check(
		bounds.tx <= 0 &&
			bounds.tx >= -2400 &&
			bounds.ty <= 0 &&
			bounds.ty >= -1800,
		"pan escaped the clamp: " + JSON.stringify(bounds),
	);

	// (e) Double-tap glides home - and both taps still poke
	// (pinch-zoom Decision 2: no hold-off)
	await page.evaluate(() => {
		const rig = window.kwigbelleScene.layerSprings;
		window.__pokeCount = 0;
		const original = rig.poke.bind(rig);
		rig.poke = (point) => {
			window.__pokeCount++;
			original(point);
		};
	});
	await page.mouse.click(400, 300);
	await page.mouse.click(400, 300);
	await page.waitForFunction(() => window.kwigbelleScene.zoomView.scale === 1, {
		timeout: 5000,
	});
	const pokeCount = await page.evaluate(() => window.__pokeCount);
	console.log("double-tap poke count:", pokeCount);
	check(pokeCount === 2, `double-tap fired ${pokeCount} pokes (expected 2)`);
	// The settle after the glide re-rasters back to base size
	await page.waitForFunction(
		() =>
			(window.kwigbelleScene.avastar.rasterScale || 1) === 1 &&
			window.kwigbelleScene.avastar.layers[0].width === 800,
		{ timeout: 8000 },
	);
	console.log("re-raster back to base:", JSON.stringify(await zoomState()));

	// (f) A two-finger pinch zooms, and its touchmove is cancelled
	const moveNotPrevented = await page.evaluate(() => {
		const canvas = document.getElementById("mainCanvas");
		const touch = (id, x, y) =>
			new Touch({ identifier: id, target: canvas, clientX: x, clientY: y });
		const fire = (type, touches) =>
			canvas.dispatchEvent(
				new TouchEvent(type, {
					touches,
					changedTouches: touches,
					cancelable: true,
					bubbles: true,
				}),
			);
		fire("touchstart", [touch(1, 350, 300), touch(2, 450, 300)]);
		// Spread the fingers: 100px apart -> 300px apart
		const result = fire("touchmove", [touch(1, 250, 300), touch(2, 550, 300)]);
		fire("touchend", []);
		return result;
	});
	const pinched = await zoomState();
	console.log("pinched:", JSON.stringify(pinched));
	check(pinched.scale > 2, "pinch did not zoom: " + pinched.scale);
	check(
		moveNotPrevented === false,
		"multi-touch touchmove not cancelled (browser pinch not suppressed)",
	);

	// (g) A token load resets zoom AND raster scale
	await page.waitForFunction(
		() => (window.kwigbelleScene.avastar.rasterScale || 1) > 1,
		{ timeout: 8000 },
	);
	await page.evaluate(() => window.kwigbelleScene.selectAvastar(25495));
	await page.waitForFunction(
		() =>
			document.getElementById("preloader")?.style.opacity === "0" &&
			String(window.kwigbelleScene.avastar.tokenId) === "25495",
		{ timeout: 15000 },
	);
	const afterLoad = await zoomState();
	console.log("after token load:", JSON.stringify(afterLoad));
	check(afterLoad.scale === 1, "token load kept the zoom: " + afterLoad.scale);
	check(
		afterLoad.rasterScale === 1 && afterLoad.layerWidth === 800,
		"token load kept a zoomed raster: " + JSON.stringify(afterLoad),
	);

	console.log("errors:", errors.length ? errors : "none");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
