// Log FAIL and mark the process exit code instead of throwing, so one
// failed check doesn't hide the rest of a run's evidence.
function check(cond, msg) {
	if (!cond) {
		process.exitCode = 1;
		console.error("FAIL: " + msg);
	}
	return cond;
}
// The site's editorial copy, for asserting UI text against the
// Strings keys instead of hardcoded literals - a copy pass through
// the editor page then never breaks a test. Frozen FACTS (tier
// bands, token-id ranges, counts) stay literal in tests on
// purpose: they pin truth, not wording.
//
// Strings.js is dependency-free ESM in a CJS package (the root
// package.json deliberately has no "type": "module" - Tools/ is
// CJS), so import() would reject it; evaluate the committed file
// with the export keyword stripped instead.
function strings() {
	const fs = require("fs");
	const path = require("path");
	const source = fs.readFileSync(
		path.join(__dirname, "..", "Lib", "Strings.js"),
		"utf8",
	);
	return new Function(
		source.replace("export const Strings", "const Strings") +
			"\nreturn Strings;",
	)();
}
module.exports = { check, strings };
