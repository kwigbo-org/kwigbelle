const { chromium } = require("playwright-core");
const { check } = require("./check.js");

(async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
	page.on("console", (m) => {
		if (m.type() === "error") errors.push("console: " + m.text());
	});

	// The 3D section's backup indicator HEADs vrm/<file>; the test
	// server has no mirror, so answer 200 to keep the console clean
	await page.route("**/vrm/Avastar_*.vrm", (route) =>
		route.fulfill({ status: 200, body: "" }),
	);
	await page.goto("http://localhost:8741/index.html?tokenid=8014");
	// Wait for the preloader to fade (load + parse complete)
	await page.waitForFunction(
		() => document.getElementById("preloader")?.style.opacity === "0",
		{ timeout: 15000 },
	);
	// Let the springs settle into the idle breathing loop
	await page.waitForTimeout(1500);
	await page.screenshot({ path: "idle-1.png" });
	// Capture again mid-breath to prove the idle animation moves
	await page.waitForTimeout(1200);
	await page.screenshot({ path: "idle-2.png" });

	// Press the mouse near a corner and drag — layers should spring toward it
	await page.mouse.move(650, 150);
	await page.mouse.down();
	await page.waitForTimeout(700);
	await page.screenshot({ path: "follow.png" });
	await page.mouse.up();
	// Release — layers should spring back toward center with overshoot
	await page.waitForTimeout(400);
	await page.screenshot({ path: "release.png" });

	const drawn = await page.evaluate(() => {
		const c = document.getElementById("mainCanvas");
		return (
			c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1)
				.data[3] !== 0
		);
	});
	console.log("drawn:", drawn, "errors:", errors.length ? errors : "none");
	check(drawn, "avatar not drawn on canvas");
	check(errors.length === 0, "page errors: " + JSON.stringify(errors));
	await browser.close();
})();
