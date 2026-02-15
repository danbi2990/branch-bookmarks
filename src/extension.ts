import * as vscode from "vscode";
import * as path from "path";
import { BookmarkStore } from "./bookmarkStore";
import { GitService } from "./gitService";
import { BookmarkTreeDataProvider } from "./bookmarkTreeView";
import type { BookmarkTreeItem } from "./bookmarkTreeView";
import { DecorationManager } from "./decorationManager";
import type { Bookmark, SortOrder } from "./types";

let bookmarkStore: BookmarkStore;
let gitService: GitService;
let treeDataProvider: BookmarkTreeDataProvider;
let decorationManager: DecorationManager;
const pendingOperations = new Set<Promise<unknown>>();
const DEFAULT_BRANCH_TRANSITION_DELAY_MS = 500;
let manualSuspendUntil = 0;
let manualSuspendTimer: ReturnType<typeof setTimeout> | undefined;

export interface ExtensionTestApi {
	getBookmarkStore(): BookmarkStore;
	createStoreFromStorage(): BookmarkStore;
	getTreeDataProvider(): BookmarkTreeDataProvider;
	beginBranchTransitionForTest(durationMs?: number): void;
	clearBranchTransitionForTest(): void;
	whenIdle(): Promise<void>;
}

function trackPendingOperation<T>(promise: Promise<T>): Promise<T> {
	pendingOperations.add(promise);
	void promise
		.catch((error: unknown) => {
			console.error("Background bookmark operation failed:", error);
		})
		.finally(() => {
			pendingOperations.delete(promise);
		});
	return promise;
}

async function waitForPendingOperations(): Promise<void> {
	while (pendingOperations.size > 0) {
		await Promise.allSettled(Array.from(pendingOperations));
	}
	// Yield one tick so follow-up listeners can finish.
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function getBranchTransitionDelayMs(): number {
	const configuredDelay = vscode.workspace
		.getConfiguration("bookmark")
		.get<number>(
			"branchTransitionDelayMs",
			DEFAULT_BRANCH_TRANSITION_DELAY_MS,
		);
	if (
		typeof configuredDelay !== "number" ||
		!Number.isFinite(configuredDelay)
	) {
		return DEFAULT_BRANCH_TRANSITION_DELAY_MS;
	}
	return Math.max(0, Math.floor(configuredDelay));
}

function beginManualLineTrackingSuspension(durationMs: number): void {
	const safeDurationMs = Math.max(0, Math.floor(durationMs));
	manualSuspendUntil = Date.now() + safeDurationMs;
	decorationManager.clearAllDecorations();

	if (manualSuspendTimer) {
		clearTimeout(manualSuspendTimer);
	}
	manualSuspendTimer = setTimeout(() => {
		manualSuspendUntil = 0;
		manualSuspendTimer = undefined;
		treeDataProvider.refresh();
		decorationManager.refreshAllDecorations();
	}, safeDurationMs);
}

function isLineTrackingSuspended(): boolean {
	return Date.now() < manualSuspendUntil;
}

function clearLineTrackingSuspension(): void {
	if (manualSuspendTimer) {
		clearTimeout(manualSuspendTimer);
		manualSuspendTimer = undefined;
	}
	manualSuspendUntil = 0;
}

export function activate(
	context: vscode.ExtensionContext,
): ExtensionTestApi {
	console.log("Bookmark Extension is now active!");

	// Initialize services
	gitService = new GitService();
	bookmarkStore = new BookmarkStore(context);
	treeDataProvider = new BookmarkTreeDataProvider(bookmarkStore, gitService);
	decorationManager = new DecorationManager(bookmarkStore, gitService);

	// Register TreeView
	const treeView = vscode.window.createTreeView("bookmarkView", {
		treeDataProvider: treeDataProvider,
		showCollapseAll: true,
	});

	// Register commands
	const commands = [
		vscode.commands.registerCommand("bookmark.toggle", toggleBookmark),
		vscode.commands.registerCommand("bookmark.listQuickPick", showQuickPick),
		vscode.commands.registerCommand(
			"bookmark.focusSidebar",
			focusBookmarkSidebar,
		),
		vscode.commands.registerCommand(
			"bookmark.changeSortOrder",
			changeSortOrder,
		),
		vscode.commands.registerCommand("bookmark.clearAll", clearAllBookmarks),
		vscode.commands.registerCommand("bookmark.refresh", () =>
			treeDataProvider.refresh(),
		),
		vscode.commands.registerCommand("bookmark.goToBookmark", goToBookmark),
		vscode.commands.registerCommand("bookmark.removeFromView", removeFromView),
	];

	// File system watcher for renames
	const fileWatcher = vscode.workspace.onDidRenameFiles((e) => {
		void trackPendingOperation(
			(async () => {
				for (const file of e.files) {
					await bookmarkStore.updateFilePath(
						file.oldUri.fsPath,
						file.newUri.fsPath,
					);
				}
				treeDataProvider.refresh();
			})(),
		);
	});

	// Document change listener for line tracking
	const documentChangeListener = vscode.workspace.onDidChangeTextDocument(
		(e) => {
			if (e.contentChanges.length > 0) {
				if (isLineTrackingSuspended()) {
					return;
				}
				const filePath = e.document.uri.fsPath;
				const branchName = gitService.getCurrentBranch();
				void trackPendingOperation(
					bookmarkStore
						.updateLineNumbers(filePath, branchName, [...e.contentChanges])
						.then(() => {
							treeDataProvider.refresh();
						}),
				);
			}
		},
	);

	// Branch change listener
	const branchChangeListener = gitService.onDidChangeBranch(() => {
		beginManualLineTrackingSuspension(getBranchTransitionDelayMs());
		treeDataProvider.refresh();
	});

	// Auto-cleanup on activation
	void trackPendingOperation(performCleanup());

	// Push all disposables
	context.subscriptions.push(
		treeView,
		...commands,
		fileWatcher,
		documentChangeListener,
		branchChangeListener,
		new vscode.Disposable(() => {
			clearLineTrackingSuspension();
		}),
		gitService,
		decorationManager,
	);

	return {
		getBookmarkStore: () => bookmarkStore,
		createStoreFromStorage: () => new BookmarkStore(context),
		getTreeDataProvider: () => treeDataProvider,
		beginBranchTransitionForTest: (durationMs?: number) => {
			beginManualLineTrackingSuspension(
				durationMs ?? getBranchTransitionDelayMs(),
			);
		},
		clearBranchTransitionForTest: clearLineTrackingSuspension,
		whenIdle: waitForPendingOperations,
	};
}

async function toggleBookmark(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage("No active editor");
		return;
	}

	const lineNumber = editor.selection.active.line;
	const filePath = editor.document.uri.fsPath;
	const branchName = gitService.getCurrentBranch();

	if (bookmarkStore.hasBookmarkAtLine(filePath, lineNumber, branchName)) {
		await bookmarkStore.removeAtLine(filePath, lineNumber, branchName);
	} else {
		const lineText = editor.document.lineAt(lineNumber).text;
		await bookmarkStore.add(filePath, lineNumber, branchName, lineText);
	}

	treeDataProvider.refresh();
}

async function showQuickPick(): Promise<void> {
	const currentBranch = gitService.getCurrentBranch();
	const bookmarks = bookmarkStore.getAllBookmarksForBranch(currentBranch);

	if (bookmarks.length === 0) {
		vscode.window.showInformationMessage("No bookmarks found");
		return;
	}

	const sortOrder = treeDataProvider.getSortOrder();
	const sortedBookmarks = bookmarkStore.sortBookmarks(bookmarks, sortOrder);

	interface BookmarkQuickPickItem extends vscode.QuickPickItem {
		bookmark: Bookmark;
	}

	const items: BookmarkQuickPickItem[] = sortedBookmarks.map((b) => {
		const fileName = path.basename(b.filePath);
		const lineNum = b.lineNumber + 1;

		return {
			label: `$(bookmark) ${fileName}:${lineNum}`,
			description: b.lineText?.trim().substring(0, 60) || "",
			detail: b.filePath,
			bookmark: b,
		};
	});

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: "Select a bookmark to navigate to",
		matchOnDescription: true,
		matchOnDetail: true,
	});

	if (selected) {
		await goToBookmark(selected.bookmark);
	}
}

async function focusBookmarkSidebar(): Promise<void> {
	await vscode.commands.executeCommand("bookmarkView.focus");
}

async function changeSortOrder(): Promise<void> {
	interface SortOptionItem extends vscode.QuickPickItem {
		value: SortOrder;
	}

	const currentSort = treeDataProvider.getSortOrder();
	const options: SortOptionItem[] = [
		{
			label: "$(list-ordered) Line Number",
			description: currentSort === "lineNumber" ? "(current)" : "",
			value: "lineNumber",
		},
		{
			label: "$(calendar) Date Added",
			description: currentSort === "dateAdded" ? "(current)" : "",
			value: "dateAdded",
		},
	];

	const selected = await vscode.window.showQuickPick(options, {
		placeHolder: "Sort bookmarks by...",
	});

	if (selected) {
		treeDataProvider.setSortOrder(selected.value);
		vscode.window.showInformationMessage(
			`Bookmarks sorted by ${selected.value === "lineNumber" ? "line number" : "date added"}`,
		);
	}
}

async function clearAllBookmarks(): Promise<void> {
	const confirm = await vscode.window.showWarningMessage(
		"Are you sure you want to clear all bookmarks?",
		{ modal: true },
		"Yes",
		"No",
	);

	if (confirm === "Yes") {
		await bookmarkStore.clearAll();
		treeDataProvider.refresh();
		vscode.window.showInformationMessage("All bookmarks cleared");
	}
}

async function goToBookmark(bookmark: Bookmark): Promise<void> {
	try {
		const document = await vscode.workspace.openTextDocument(bookmark.filePath);
		const editor = await vscode.window.showTextDocument(document);

		const lineNumber = Math.min(bookmark.lineNumber, document.lineCount - 1);
		const range = new vscode.Range(lineNumber, 0, lineNumber, 0);

		editor.selection = new vscode.Selection(range.start, range.start);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
	} catch (_error) {
		vscode.window.showErrorMessage(`Could not open file: ${bookmark.filePath}`);
	}
}

async function removeFromView(item: BookmarkTreeItem): Promise<void> {
	if (item?.bookmark) {
		await bookmarkStore.remove(item.bookmark.id);
		treeDataProvider.refresh();
	}
}

async function performCleanup(): Promise<void> {
	const removedCount = await bookmarkStore.cleanup();
	if (removedCount > 0) {
		vscode.window.showInformationMessage(
			`Cleaned up ${removedCount} invalid bookmark(s)`,
		);
		treeDataProvider.refresh();
	}
}

export function deactivate() {
	// Cleanup handled by disposables
}
