import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Test Suite", () => {
	vscode.window.showInformationMessage("Start all tests.");

	test("Extension should be present", () => {
		assert.ok(vscode.extensions.getExtension("undefined.bookmark-extension"));
	});

	test("Commands should be registered", async () => {
		const commands = await vscode.commands.getCommands(true);

		assert.ok(commands.includes("bookmark.add"));
		assert.ok(commands.includes("bookmark.remove"));
		assert.ok(commands.includes("bookmark.toggle"));
		assert.ok(commands.includes("bookmark.listQuickPick"));
		assert.ok(commands.includes("bookmark.changeSortOrder"));
		assert.ok(commands.includes("bookmark.clearAll"));
	});
});
