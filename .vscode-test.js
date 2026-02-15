const { defineConfig } = require("@vscode/test-cli");

module.exports = defineConfig({
	files: "out/test/**/*.test.js",
	workspaceFolder: "./src/test/fixture/workspace",
	mocha: {
		ui: "tdd",
		color: true,
		timeout: 20000,
	},
});
