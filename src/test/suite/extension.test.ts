import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import type { Bookmark } from "../../types";
import type { ExtensionTestApi } from "../../extension";

suite("Branch Bookmarks Integration", () => {
	const createdFileUris: vscode.Uri[] = [];

	async function getApi(): Promise<ExtensionTestApi> {
		const extension = vscode.extensions.all.find(
			(candidate) => candidate.packageJSON.name === "branch-bookmarks",
		);
		assert.ok(extension, "branch-bookmarks must be installed for tests");
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

		const dirName = path.dirname(fileName);
		if (dirName !== ".") {
			await vscode.workspace.fs.createDirectory(
				vscode.Uri.joinPath(workspace.uri, dirName),
			);
		}

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
		await vscode.commands.executeCommand("bookmark.toggle");
	}

	async function addBookmarkAtLineAndWait(
		api: ExtensionTestApi,
		editor: vscode.TextEditor,
		lineNumber: number,
	): Promise<void> {
		await addBookmarkAtLine(editor, lineNumber);
		await api.whenIdle();
	}

	async function applyEditorEditAndWait(
		api: ExtensionTestApi,
		editor: vscode.TextEditor,
		editCallback: (editBuilder: vscode.TextEditorEdit) => void,
	): Promise<void> {
		await editor.edit(editCallback);
		await api.whenIdle();
	}

	function getBookmarksForFile(
		api: ExtensionTestApi,
		filePath: string,
	): Bookmark[] {
		return api.getBookmarkStore().getBookmarksForFileAllBranches(filePath);
	}

	function assertBookmarkCount(
		api: ExtensionTestApi,
		filePath: string,
		expectedCount: number,
	): Bookmark[] {
		const bookmarks = getBookmarksForFile(api, filePath);
		assert.strictEqual(bookmarks.length, expectedCount);
		return bookmarks;
	}

	function assertSingleBookmarkLine(
		api: ExtensionTestApi,
		filePath: string,
		expectedLine: number,
	): Bookmark {
		const bookmarks = assertBookmarkCount(api, filePath, 1);
		assert.strictEqual(bookmarks[0].lineNumber, expectedLine);
		return bookmarks[0];
	}

	async function expectSingleBookmarkLineAfterEditorEdit(
		api: ExtensionTestApi,
		fileName: string,
		content: string,
		bookmarkedLine: number,
		expectedLine: number,
		editCallback: (
			editBuilder: vscode.TextEditorEdit,
			editor: vscode.TextEditor,
		) => void,
	): Promise<void> {
		const editor = await openFixtureEditor(fileName, content);
		const filePath = editor.document.uri.fsPath;
		await addBookmarkAtLineAndWait(api, editor, bookmarkedLine);
		await applyEditorEditAndWait(api, editor, (builder) => {
			editCallback(builder, editor);
		});
		assertSingleBookmarkLine(api, filePath, expectedLine);
	}

	suiteSetup(async () => {
		await getApi();
	});

	setup(async () => {
		const api = await getApi();
		api.clearBranchTransitionForTest();
		await api.getBookmarkStore().clearAll();
		await vscode.workspace
			.getConfiguration("bookmark")
			.update(
				"branchTransitionDelayMs",
				500,
				vscode.ConfigurationTarget.Workspace,
			);
		await api.whenIdle();
	});

	teardown(async () => {
		const api = await getApi();
		api.clearBranchTransitionForTest();
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

		assertSingleBookmarkLine(api, filePath, targetLine);

		await vscode.commands.executeCommand("bookmark.toggle");
		await api.whenIdle();

		assertBookmarkCount(api, filePath, 0);
	});

	test("bookmark line shifts after text insertion above it", async () => {
		const api = await getApi();
		await expectSingleBookmarkLineAfterEditorEdit(
			api,
			"line-shift-test.ts",
			buildLines(40),
			19,
			22,
			(builder) => {
				builder.insert(new vscode.Position(5, 0), "new-a\nnew-b\nnew-c\n");
			},
		);
	});

	test("go to bookmark realigns stale line number using stored line text", async () => {
		const api = await getApi();
		const content = [
			"new-1",
			"new-2",
			"header",
			"const a = 1;",
			"const important = 42;",
			"footer",
		].join("\n");
		const editor = await openFixtureEditor("go-to-realign-test.ts", content);
		const filePath = editor.document.uri.fsPath;

		// Create bookmark at the correct line first.
		await addBookmarkAtLineAndWait(api, editor, 4);

		const store = api.getBookmarkStore();
		const initialBookmark = getBookmarksForFile(api, filePath)[0];
		assert.ok(initialBookmark, "bookmark should exist before external file update");
		assert.strictEqual(initialBookmark.lineText, "const important = 42;");

		// Simulate stale line tracking (e.g. missed external update).
		await store.updateBookmarkLocation(
			initialBookmark.id,
			2,
			initialBookmark.lineText,
		);
		const staleBookmark = {
			...getBookmarksForFile(api, filePath)[0],
		};
		assert.strictEqual(staleBookmark.lineNumber, 2);

		await vscode.commands.executeCommand("bookmark.goToBookmark", staleBookmark);
		await api.whenIdle();

		const activeEditor = vscode.window.activeTextEditor;
		assert.ok(activeEditor, "goToBookmark should open the file");
		assert.strictEqual(activeEditor.document.uri.fsPath, filePath);
		assert.strictEqual(activeEditor.selection.active.line, 4);

		const refreshedBookmark = getBookmarksForFile(api, filePath).find(
			(bookmark) => bookmark.id === staleBookmark.id,
		);
		assert.ok(refreshedBookmark, "bookmark should still exist after realignment");
		assert.strictEqual(refreshedBookmark?.lineNumber, 4);
		assert.strictEqual(refreshedBookmark?.lineText, "const important = 42;");
	});

	test("bookmark at first line shifts when a line is inserted above it", async () => {
		const api = await getApi();
		await expectSingleBookmarkLineAfterEditorEdit(
			api,
			"first-line-insert-above-test.ts",
			buildLines(8),
			0,
			1,
			(builder) => {
				builder.insert(new vscode.Position(0, 0), "new-top\n");
			},
		);
	});

	test("bookmark at last line stays when a new line is appended below", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor(
			"last-line-append-below-test.ts",
			buildLines(6),
		);
		const filePath = editor.document.uri.fsPath;
		const lastLine = editor.document.lineCount - 1;
		const lastLineEnd = editor.document.lineAt(lastLine).range.end;

		await addBookmarkAtLineAndWait(api, editor, lastLine);

		await applyEditorEditAndWait(api, editor, (builder) => {
			builder.insert(lastLineEnd, "\nappended-line");
		});

		assertSingleBookmarkLine(api, filePath, lastLine);
	});

	test("bookmark on empty last line stays when appending a line below", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor(
			"empty-last-line-append-below-test.ts",
			`${buildLines(6)}\n`,
		);
		const filePath = editor.document.uri.fsPath;
		const emptyLastLine = editor.document.lineCount - 1;

		assert.strictEqual(editor.document.lineAt(emptyLastLine).text, "");
		await addBookmarkAtLineAndWait(api, editor, emptyLastLine);

		await applyEditorEditAndWait(api, editor, (builder) => {
			builder.insert(
				new vscode.Position(emptyLastLine, 0),
				"\nappended-after-empty-last-line",
			);
		});

		assertSingleBookmarkLine(api, filePath, emptyLastLine);
	});

	test("pressing Enter on empty last line does not duplicate bookmark", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor(
			"empty-last-line-enter-no-duplicate-test.ts",
			`${buildLines(6)}\n`,
		);
		const filePath = editor.document.uri.fsPath;
		const emptyLastLine = editor.document.lineCount - 1;

		assert.strictEqual(editor.document.lineAt(emptyLastLine).text, "");
		await addBookmarkAtLineAndWait(api, editor, emptyLastLine);

		await vscode.commands.executeCommand("type", { text: "\n" });
		await api.whenIdle();

		assertBookmarkCount(api, filePath, 1);
	});

	test("line tracking is suppressed during branch transition", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor(
			"branch-transition-suppress.ts",
			buildLines(30),
		);
		const filePath = editor.document.uri.fsPath;
		const bookmarkedLine = 12;

		await addBookmarkAtLineAndWait(api, editor, bookmarkedLine);

		api.beginBranchTransitionForTest(300);
		await applyEditorEditAndWait(api, editor, (builder) => {
			builder.insert(new vscode.Position(0, 0), "shift-1\nshift-2\n");
		});

		assertSingleBookmarkLine(api, filePath, bookmarkedLine);
		api.clearBranchTransitionForTest();
	});

	test("configured branch transition delay is used when test API duration is omitted", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor(
			"branch-transition-configured-delay.ts",
			buildLines(30),
		);
		const filePath = editor.document.uri.fsPath;
		const bookmarkedLine = 10;

		await addBookmarkAtLineAndWait(api, editor, bookmarkedLine);

		await vscode.workspace
			.getConfiguration("bookmark")
			.update(
				"branchTransitionDelayMs",
				120,
				vscode.ConfigurationTarget.Workspace,
			);

		api.beginBranchTransitionForTest();
		await applyEditorEditAndWait(api, editor, (builder) => {
			builder.insert(new vscode.Position(0, 0), "suppressed-shift\n");
		});

		assertSingleBookmarkLine(api, filePath, bookmarkedLine);

		await sleep(180);
		await applyEditorEditAndWait(api, editor, (builder) => {
			builder.insert(new vscode.Position(0, 0), "tracked-shift\n");
		});

		assertSingleBookmarkLine(api, filePath, bookmarkedLine + 1);
		api.clearBranchTransitionForTest();
	});

	test("bookmark is removed when deleted range includes bookmarked line", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("delete-range-test.ts", buildLines(35));
		const filePath = editor.document.uri.fsPath;

		await addBookmarkAtLineAndWait(api, editor, 10);

		await applyEditorEditAndWait(api, editor, (builder) => {
			builder.delete(new vscode.Range(8, 0, 12, 0));
		});

		assertBookmarkCount(api, filePath, 0);
	});

	test("replace edit with net line delta shifts bookmarks below changed range", async () => {
		const api = await getApi();
		await expectSingleBookmarkLineAfterEditorEdit(
			api,
			"replace-delta-test.ts",
			buildLines(40),
			18,
			19,
			(builder) => {
				builder.replace(
					new vscode.Range(5, 0, 8, 0),
					"r-1\nr-2\nr-3\nr-4\n",
				);
			},
		);
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

		await addBookmarkAtLineAndWait(api, editor, bookmarkedLine);

		const lastLine = editor.document.lineCount - 1;
		const lastChar = editor.document.lineAt(lastLine).text.length;
		await applyEditorEditAndWait(api, editor, (builder) => {
			builder.replace(new vscode.Range(0, 0, lastLine, lastChar), formatted);
		});

		assertSingleBookmarkLine(api, filePath, bookmarkedLine);
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

		await addBookmarkAtLineAndWait(api, editor, bookmarkedLine);

		// Simulates formatter removing the blank line (line 2 in 1-based indexing).
		await applyEditorEditAndWait(api, editor, (builder) => {
			builder.delete(new vscode.Range(1, 0, 2, 0));
		});

		assertSingleBookmarkLine(api, filePath, 1);
	});

	test("multiple workspace edits in one apply shift bookmark cumulatively", async () => {
		const api = await getApi();
		const editor = await openFixtureEditor("multi-edit-test.ts", buildLines(50));
		const filePath = editor.document.uri.fsPath;
		const originalLine = 25;

		await addBookmarkAtLineAndWait(api, editor, originalLine);

		const edit = new vscode.WorkspaceEdit();
		edit.insert(editor.document.uri, new vscode.Position(3, 0), "first\n");
		edit.insert(editor.document.uri, new vscode.Position(8, 0), "second\n");
		await vscode.workspace.applyEdit(edit);
		await api.whenIdle();

		assertSingleBookmarkLine(api, filePath, originalLine + 2);
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

		await addBookmarkAtLineAndWait(api, editor, 4);

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
		assertSingleBookmarkLine(api, renamedPath, 4);
	});

	test("updateFilePath merges into existing destination key", async () => {
		const api = await getApi();
		const sourceEditor = await openFixtureEditor("merge-source.ts", buildLines(12));
		const targetEditor = await openFixtureEditor("merge-target.ts", buildLines(12));
		const sourcePath = sourceEditor.document.uri.fsPath;
		const targetPath = targetEditor.document.uri.fsPath;
		const store = api.getBookmarkStore();

		await store.add(sourcePath, 2, "main", "line-3");
		await store.add(targetPath, 7, "main", "line-8");
		await store.updateFilePath(sourcePath, targetPath);

		const sourceBookmarks = store.getBookmarksForFile(sourcePath, "main");
		const targetBookmarks = store.getBookmarksForFile(targetPath, "main");
		assert.strictEqual(sourceBookmarks.length, 0);
		assert.strictEqual(targetBookmarks.length, 2);
		assert.deepStrictEqual(
			targetBookmarks.map((bookmark) => bookmark.lineNumber).sort((a, b) => a - b),
			[2, 7],
		);
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
		await addBookmarkAtLineAndWait(api, editorCurrent, 1);

		const editorOther = await openFixtureEditor(
			"other-branch-hidden.ts",
			buildLines(8, "oth"),
		);
		const currentPath = editorCurrent.document.uri.fsPath;
		const otherPath = editorOther.document.uri.fsPath;

		const currentBranchBookmark = getBookmarksForFile(api, currentPath)[0];
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

	test("tree file item shows workspace-relative directory when possible", async () => {
		const api = await getApi();
		const provider = api.getTreeDataProvider();
		const editor = await openFixtureEditor(
			"nested/folder/relative-path-tree.ts",
			buildLines(6),
		);

		await addBookmarkAtLineAndWait(api, editor, 2);

		const rootItems = (await provider.getChildren()) as vscode.TreeItem[];
		const target = rootItems.find(
			(item) => String(item.label) === "relative-path-tree.ts",
		);
		assert.ok(target, "tree item for nested file should exist");
		assert.strictEqual(String(target.description), "nested/folder");
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

	test("tree provider returns line-content labels ordered by line number", async () => {
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

		const lineChildren = (await provider.getChildren(rootItems[0] as never)).map(
			(item) => String(item.label),
		);
		assert.deepStrictEqual(lineChildren, ["a-3", "a-9"]);
	});
});
