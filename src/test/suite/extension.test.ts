import * as assert from "assert";
import * as vscode from "vscode";
import type { Bookmark } from "../../types";
import type { ExtensionTestApi } from "../../extension";

suite("Bookmark Extension Integration", () => {
	const createdFileUris: vscode.Uri[] = [];

	async function getApi(): Promise<ExtensionTestApi> {
		const extension = vscode.extensions.all.find(
			(candidate) => candidate.packageJSON.name === "bookmark-extension",
		);
		assert.ok(extension, "bookmark-extension must be installed for tests");
		return (await extension.activate()) as ExtensionTestApi;
	}

	function buildLines(count: number, prefix = "line"): string {
		return Array.from(
			{ length: count },
			(_, index) => `${prefix}-${index + 1}`,
		).join("\n");
	}

	async function sleep(ms: number): Promise<void> {
		await new Promise<void>((resolve) => setTimeout(resolve, ms));
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

	async function addBookmarkAtLine(
		editor: vscode.TextEditor,
		lineNumber: number,
	): Promise<void> {
		editor.selection = new vscode.Selection(lineNumber, 0, lineNumber, 0);
		await vscode.commands.executeCommand("bookmark.add");
	}

	suiteSetup(async () => {
		await getApi();
	});

	setup(async () => {
		const api = await getApi();
		await api.getBookmarkStore().clearAll();
		await vscode.workspace
			.getConfiguration("bookmark")
			.update("defaultSortOrder", "lineNumber", vscode.ConfigurationTarget.Workspace);
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
		assert.strictEqual(bookmarks.length, 1);
		assert.strictEqual(bookmarks[0].lineNumber, targetLine);

		await vscode.commands.executeCommand("bookmark.toggle");
		await api.whenIdle();

		bookmarks = api.getBookmarkStore().getBookmarksForFileAllBranches(filePath);
		assert.strictEqual(bookmarks.length, 0);
	});

	test("bookmark line shifts after text insertion above it", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("line-shift-test.ts", buildLines(40));
		const filePath = editor.document.uri.fsPath;
		const originalLine = 19;

		await addBookmarkAtLine(editor, originalLine);
		await api.whenIdle();

		await editor.edit((builder) => {
			builder.insert(new vscode.Position(5, 0), "new-a\nnew-b\nnew-c\n");
		});
		await api.whenIdle();

		const bookmarks = api.getBookmarkStore().getBookmarksForFileAllBranches(filePath);
		assert.strictEqual(bookmarks.length, 1);
		assert.strictEqual(bookmarks[0].lineNumber, originalLine + 3);
	});

	test("bookmark is removed when deleted range includes bookmarked line", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("delete-range-test.ts", buildLines(35));
		const filePath = editor.document.uri.fsPath;

		await addBookmarkAtLine(editor, 10);
		await api.whenIdle();

		await editor.edit((builder) => {
			builder.delete(new vscode.Range(8, 0, 12, 0));
		});
		await api.whenIdle();

		const bookmarks = api.getBookmarkStore().getBookmarksForFileAllBranches(filePath);
		assert.strictEqual(bookmarks.length, 0);
	});

	test("replace edit with net line delta shifts bookmarks below changed range", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("replace-delta-test.ts", buildLines(40));
		const filePath = editor.document.uri.fsPath;
		const originalLine = 18;

		await addBookmarkAtLine(editor, originalLine);
		await api.whenIdle();

		await editor.edit((builder) => {
			builder.replace(
				new vscode.Range(5, 0, 8, 0),
				"r-1\nr-2\nr-3\nr-4\n",
			);
		});
		await api.whenIdle();

		const bookmarks = api.getBookmarkStore().getBookmarksForFileAllBranches(filePath);
		assert.strictEqual(bookmarks.length, 1);
		assert.strictEqual(bookmarks[0].lineNumber, originalLine + 1);
	});

	test("bookmark is preserved after format-like full-document replacement", async () => {
		const api = await getApi();
		const original = [
			"function test( ) {",
			"  const a=1;",
			"  const b=2;",
			"  return a+b;",
			"}",
		].join("\n");
		const formatted = [
			"function test() {",
			"  const a = 1;",
			"  const b = 2;",
			"  return a + b;",
			"}",
		].join("\n");
		const editor = await openFixtureEditor("format-replace-test.ts", original);
		const filePath = editor.document.uri.fsPath;
		const bookmarkedLine = 3;

		await addBookmarkAtLine(editor, bookmarkedLine);
		await api.whenIdle();

		const lastLine = editor.document.lineCount - 1;
		const lastChar = editor.document.lineAt(lastLine).text.length;
		await editor.edit((builder) => {
			builder.replace(new vscode.Range(0, 0, lastLine, lastChar), formatted);
		});
		await api.whenIdle();

		const bookmarks = api.getBookmarkStore().getBookmarksForFileAllBranches(filePath);
		assert.strictEqual(bookmarks.length, 1);
		assert.strictEqual(bookmarks[0].lineNumber, bookmarkedLine);
	});

	test("bookmark survives when formatting removes a blank line above it", async () => {
		const api = await getApi();
		const source = [
			"function test( ) {",
			"",
			"  const b=2;",
			"  return a+b;",
			"}",
		].join("\n");
		const editor = await openFixtureEditor("format-blank-line-test.ts", source);
		const filePath = editor.document.uri.fsPath;
		const bookmarkedLine = 2;

		await addBookmarkAtLine(editor, bookmarkedLine);
		await api.whenIdle();

		// Simulates formatter removing the blank line (line 2 in 1-based indexing).
		await editor.edit((builder) => {
			builder.delete(new vscode.Range(1, 0, 2, 0));
		});
		await api.whenIdle();

		const bookmarks = api.getBookmarkStore().getBookmarksForFileAllBranches(filePath);
		assert.strictEqual(bookmarks.length, 1);
		assert.strictEqual(bookmarks[0].lineNumber, 1);
	});

	test("multiple workspace edits in one apply shift bookmark cumulatively", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("multi-edit-test.ts", buildLines(50));
		const filePath = editor.document.uri.fsPath;
		const originalLine = 25;

		await addBookmarkAtLine(editor, originalLine);
		await api.whenIdle();

		const edit = new vscode.WorkspaceEdit();
		edit.insert(editor.document.uri, new vscode.Position(3, 0), "first\n");
		edit.insert(editor.document.uri, new vscode.Position(8, 0), "second\n");
		await vscode.workspace.applyEdit(edit);
		await api.whenIdle();

		const bookmarks = api.getBookmarkStore().getBookmarksForFileAllBranches(filePath);
		assert.strictEqual(bookmarks.length, 1);
		assert.strictEqual(bookmarks[0].lineNumber, originalLine + 2);
	});

	test("rename updates bookmark file path", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("rename-source.ts", buildLines(15));
		const originalUri = editor.document.uri;
		const workspace = vscode.workspace.workspaceFolders?.[0];
		assert.ok(workspace, "workspace folder is required for rename test");
		const renamedUri = vscode.Uri.joinPath(workspace.uri, "rename-target.ts");
		const originalPath = originalUri.fsPath;
		const renamedPath = renamedUri.fsPath;

		await addBookmarkAtLine(editor, 4);
		await api.whenIdle();

		const renameEdit = new vscode.WorkspaceEdit();
		renameEdit.renameFile(originalUri, renamedUri, {
			overwrite: true,
		});
		await vscode.workspace.applyEdit(renameEdit);
		createdFileUris.push(renamedUri);
		await sleep(20);
		await api.whenIdle();

		const store = api.getBookmarkStore();
		assert.strictEqual(store.getBookmarksForFileAllBranches(originalPath).length, 0);
		const renamedBookmarks = store.getBookmarksForFileAllBranches(renamedPath);
		assert.strictEqual(renamedBookmarks.length, 1);
		assert.strictEqual(renamedBookmarks[0].lineNumber, 4);
	});

	test("bookmarks are isolated per branch", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("branch-scope-test.ts", buildLines(12));
		const filePath = editor.document.uri.fsPath;
		const store = api.getBookmarkStore();

		await store.add(filePath, 3, "branch-A", "line-4");
		await store.add(filePath, 3, "branch-B", "line-4");
		await api.whenIdle();

		assert.strictEqual(store.getBookmarksForFile(filePath, "branch-A").length, 1);
		assert.strictEqual(store.getBookmarksForFile(filePath, "branch-B").length, 1);
		assert.strictEqual(store.getAllBookmarksForBranch("branch-A").length, 1);
		assert.strictEqual(store.getAllBookmarksForBranch("branch-B").length, 1);
	});

	test("tree provider only includes current-branch bookmarks", async () => {
		const api = await getApi();
		const provider = api.getTreeDataProvider();
		const store = api.getBookmarkStore();
		const editorCurrent = await openFixtureEditor(
			"current-branch-only-view.ts",
			buildLines(12, "cur"),
		);
		await addBookmarkAtLine(editorCurrent, 1);
		await api.whenIdle();

		const editorOther = await openFixtureEditor(
			"other-branch-hidden.ts",
			buildLines(8, "oth"),
		);
		const currentPath = editorCurrent.document.uri.fsPath;
		const otherPath = editorOther.document.uri.fsPath;

		const currentBranchBookmark =
			store.getBookmarksForFileAllBranches(currentPath)[0];
		assert.ok(currentBranchBookmark, "current branch bookmark should exist");
		const currentBranch = currentBranchBookmark.branchName;
		const otherBranch = `${currentBranch}-other`;

		await store.add(currentPath, 5, otherBranch, "cur-6");
		await store.add(otherPath, 2, otherBranch, "oth-3");
		await api.whenIdle();

		const rootItems = (await provider.getChildren()) as vscode.TreeItem[];
		const rootLabels = rootItems.map((item) => String(item.label));
		assert.ok(rootLabels.includes("current-branch-only-view.ts"));
		assert.ok(!rootLabels.includes("other-branch-hidden.ts"));

		const currentFileItem = rootItems.find(
			(item) => String(item.label) === "current-branch-only-view.ts",
		);
		assert.ok(currentFileItem, "current branch file should be visible");

		const children = (await provider.getChildren(
			currentFileItem as never,
		)) as Array<{ bookmark: { branchName: string; lineNumber: number } }>;
		assert.strictEqual(children.length, 1);
		assert.strictEqual(children[0].bookmark.branchName, currentBranch);
		assert.strictEqual(children[0].bookmark.lineNumber, 1);
	});

	test("duplicate add does not create duplicates and removeAtLine handles misses", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("dedupe-test.ts", buildLines(20));
		const filePath = editor.document.uri.fsPath;
		const store = api.getBookmarkStore();

		const first = await store.add(filePath, 6, "main", "line-7");
		const second = await store.add(filePath, 6, "main", "line-7");
		assert.strictEqual(first.id, second.id);
		assert.strictEqual(store.getBookmarksForFile(filePath, "main").length, 1);

		const removedMissing = await store.removeAtLine(filePath, 18, "main");
		assert.strictEqual(removedMissing, false);
		assert.strictEqual(store.getBookmarksForFile(filePath, "main").length, 1);
	});

	test("bookmarks persist to workspaceState storage", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("persistence-test.ts", buildLines(18));
		const filePath = editor.document.uri.fsPath;
		const store = api.getBookmarkStore();

		await store.add(filePath, 7, "main", "line-8");
		await api.whenIdle();

		const reloadedStore = api.createStoreFromStorage();
		const bookmarks = reloadedStore.getBookmarksForFile(filePath, "main");
		assert.strictEqual(bookmarks.length, 1);
		assert.strictEqual(bookmarks[0].lineNumber, 7);
	});

	test("cleanup removes bookmarks for deleted files", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("cleanup-deleted-file.ts", buildLines(10));
		const fileUri = editor.document.uri;
		const filePath = fileUri.fsPath;
		const store = api.getBookmarkStore();

		await store.add(filePath, 2, "main", "line-3");
		await vscode.workspace.fs.delete(fileUri);

		const removedCount = await store.cleanup();
		assert.strictEqual(removedCount, 1);
		assert.strictEqual(store.getBookmarksForFile(filePath, "main").length, 0);
	});

	test("cleanup removes bookmarks with out-of-range line numbers", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("cleanup-invalid-line.ts", buildLines(5));
		const filePath = editor.document.uri.fsPath;
		const store = api.getBookmarkStore();

		await store.add(filePath, 99, "main", "invalid");
		const removedCount = await store.cleanup();
		assert.strictEqual(removedCount, 1);
		assert.strictEqual(store.getBookmarksForFile(filePath, "main").length, 0);
	});

	test("sortBookmarks supports lineNumber and dateAdded modes", async () => {
		const api = await getApi();
		const store = api.getBookmarkStore();
		const bookmarks: Bookmark[] = [
			{
				id: "a",
				filePath: "/tmp/b.ts",
				lineNumber: 9,
				createdAt: 100,
				branchName: "main",
			},
			{
				id: "b",
				filePath: "/tmp/a.ts",
				lineNumber: 3,
				createdAt: 500,
				branchName: "main",
			},
			{
				id: "c",
				filePath: "/tmp/a.ts",
				lineNumber: 1,
				createdAt: 300,
				branchName: "main",
			},
		];

		const lineSorted = store.sortBookmarks(bookmarks, "lineNumber");
		assert.deepStrictEqual(
			lineSorted.map((bookmark) => bookmark.id),
			["c", "b", "a"],
		);

		const dateSorted = store.sortBookmarks(bookmarks, "dateAdded");
		assert.deepStrictEqual(
			dateSorted.map((bookmark) => bookmark.id),
			["b", "c", "a"],
		);
	});

	test("tree provider returns file and bookmark order for both sort modes", async () => {
		const api = await getApi();
		const provider = api.getTreeDataProvider();
		const store = api.getBookmarkStore();

		const editorA = await openFixtureEditor("tree-a.ts", buildLines(20, "a"));
		const editorB = await openFixtureEditor("tree-b.ts", buildLines(20, "b"));
		const pathA = editorA.document.uri.fsPath;
		const pathB = editorB.document.uri.fsPath;

		await store.add(pathB, 10, "main", "b-11");
		await sleep(3);
		await store.add(pathA, 8, "main", "a-9");
		await sleep(3);
		await store.add(pathA, 2, "main", "a-3");

		const rootItems = (await provider.getChildren()) as vscode.TreeItem[];
		const rootLabels = rootItems.map((item) => String(item.label));
		assert.deepStrictEqual(rootLabels, ["tree-a.ts", "tree-b.ts"]);

		provider.setSortOrder("lineNumber");
		const lineChildren = (await provider.getChildren(rootItems[0] as never)).map(
			(item) => String(item.label),
		);
		assert.deepStrictEqual(lineChildren, ["Line 3", "Line 9"]);

		provider.setSortOrder("dateAdded");
		const dateChildren = (await provider.getChildren(rootItems[0] as never)).map(
			(item) => String(item.label),
		);
		assert.deepStrictEqual(dateChildren, ["Line 3", "Line 9"]);
	});
});
