import js from "@eslint/js";

// Local-only lint (no CI by design): run with `npm run lint`.
// Generated and vendored trees are ignored entirely.
export default [
	{
		ignores: [
			"Lib/vendor/",
			"Traits/",
			"SVG/",
			"Tools/data/",
			"build/",
			"Tests/node_modules/",
			"node_modules/",
		],
	},
	js.configs.recommended,
	{
		// Runtime site code: browser ES modules. Web3 is a page
		// global loaded from Lib/vendor/ via a script tag.
		files: ["Lib/**/*.js"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "module",
			globals: {
				window: "readonly",
				document: "readonly",
				console: "readonly",
				fetch: "readonly",
				URL: "readonly",
				Blob: "readonly",
				Image: "readonly",
				localStorage: "readonly",
				performance: "readonly",
				URLSearchParams: "readonly",
				CustomEvent: "readonly",
				requestAnimationFrame: "readonly",
				cancelAnimationFrame: "readonly",
				Event: "readonly",
				Element: "readonly",
				File: "readonly",
				navigator: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				AbortController: "readonly",
				DOMException: "readonly",
				alert: "readonly",
				DOMParser: "readonly",
				Web3: "readonly",
			},
		},
	},
	{
		// Tooling and tests: Node scripts (CommonJS). Tests also get
		// browser globals because their page.evaluate callbacks and
		// injected mock strings execute inside headless Chrome.
		files: ["Tools/**/*.js", "Tests/**/*.js"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "commonjs",
			globals: {
				require: "readonly",
				module: "writable",
				process: "readonly",
				console: "readonly",
				__dirname: "readonly",
				Buffer: "readonly",
				fetch: "readonly",
				URL: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				window: "readonly",
				document: "readonly",
				AbortController: "readonly",
				AbortSignal: "readonly",
				performance: "readonly",
				DeviceOrientationEvent: "readonly",
				Blob: "readonly",
				getComputedStyle: "readonly",
				sessionStorage: "readonly",
				localStorage: "readonly",
				CustomEvent: "readonly",
				Event: "readonly",
				Web3: "readonly",
			},
		},
	},
	{
		rules: {
			// Empty catch blocks are an established pattern here for
			// best-effort UI steps (thumbnail fallbacks etc.)
			"no-empty": ["error", { allowEmptyCatch: true }],
			"no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", caughtErrors: "none" },
			],
		},
	},
];
