import * as assert from "assert";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../extension";

suite("Bookmark Extension Integration", () => {
	const createdFileUris: vscode.Uri[] = [];

	async function getApi(): Promise<ExtensionTestApi> {
		const extension = vscode.extensions.all.find(
			(candidate) => candidate.packageJSON.name === "bookmark-extension",
		);
		assert.ok(extension, "bookmark-extension must be installed for tests");

		const exports = (await extension.activate()) as ExtensionTestApi;
		return exports;
	}

	function buildLines(count: number): string {
		return Array.from(
			{ length: count },
			(_, index) => `line-${index + 1}`,
		).join("\n");
	}

	async function openFixtureEditor(
		fileName: string,
		content: string,
	): Promise<vscode.TextEditor> {
		const workspace = vscode.workspace.workspaceFolders?.[0];
		assert.ok(workspace, "workspace folder is required for integration tests");

		const fileUri = vscode.Uri.joinPath(workspace.uri, fileName);
		await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf8"));
		createdFileUris.push(fileUri);

		const document = await vscode.workspace.openTextDocument(fileUri);
		return vscode.window.showTextDocument(document);
	}

	suiteSetup(async () => {
		await getApi();
	});

	setup(async () => {
		const api = await getApi();
		await api.getBookmarkStore().clearAll();
		await api.whenIdle();
	});

	teardown(async () => {
		const api = await getApi();
		await api.getBookmarkStore().clearAll();
		await api.whenIdle();

		for (const uri of createdFileUris.splice(0, createdFileUris.length)) {
			try {
				await vscode.workspace.fs.delete(uri);
			} catch {
				// Ignore cleanup failures for files that were already deleted.
			}
		}
	});

	test("toggle command adds then removes bookmark at cursor", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("toggle-test.ts", buildLines(30));
		const filePath = editor.document.uri.fsPath;
		const targetLine = 9;

		editor.selection = new vscode.Selection(targetLine, 0, targetLine, 0);

		await vscode.commands.executeCommand("bookmark.toggle");
		await api.whenIdle();

		let bookmarks = api
			.getBookmarkStore()
			.getBookmarksForFileAllBranches(filePath);
		assert.strictEqual(bookmarks.length, 1, "bookmark should be created");
		assert.strictEqual(bookmarks[0].lineNumber, targetLine);

		await vscode.commands.executeCommand("bookmark.toggle");
		await api.whenIdle();

		bookmarks = api
			.getBookmarkStore()
			.getBookmarksForFileAllBranches(filePath);
		assert.strictEqual(bookmarks.length, 0, "bookmark should be removed");
	});

	test("bookmark line shifts after text insertion above it", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("line-shift-test.ts", buildLines(40));
		const filePath = editor.document.uri.fsPath;
		const originalLine = 19;

		editor.selection = new vscode.Selection(originalLine, 0, originalLine, 0);
		await vscode.commands.executeCommand("bookmark.add");
		await api.whenIdle();

		await editor.edit((builder) => {
			builder.insert(new vscode.Position(5, 0), "new-a\nnew-b\nnew-c\n");
		});
		await api.whenIdle();

		const bookmarks = api
			.getBookmarkStore()
			.getBookmarksForFileAllBranches(filePath);
		assert.strictEqual(bookmarks.length, 1, "bookmark count should stay stable");
		assert.strictEqual(bookmarks[0].lineNumber, originalLine + 3);
	});
});
