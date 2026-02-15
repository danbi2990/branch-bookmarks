import * as vscode from "vscode";
import * as path from "path";
import { BookmarkStore } from "./bookmarkStore";
import { GitService } from "./gitService";
import { BookmarkTreeDataProvider } from "./bookmarkTreeView";
import type { BookmarkTreeItem } from "./bookmarkTreeView";
import { DecorationManager } from "./decorationManager";
import type { Bookmark } from "./types";
import { toDisplayPath } from "./pathDisplay";

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
				const documentUri = e.document.uri.toString();
				void trackPendingOperation(
					bookmarkStore
						.updateLineNumbers(filePath, branchName, [...e.contentChanges])
						.then(() => {
							treeDataProvider.refresh();
							for (const editor of vscode.window.visibleTextEditors) {
								if (editor.document.uri.toString() === documentUri) {
									decorationManager.updateDecorations(editor);
								}
							}
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

	const sortedBookmarks = bookmarkStore.sortBookmarks(bookmarks, "dateAdded");

	interface BookmarkQuickPickItem extends vscode.QuickPickItem {
		bookmark: Bookmark;
	}

	const items: BookmarkQuickPickItem[] = sortedBookmarks.map((b) => {
		const fileName = path.basename(b.filePath);
		const lineNum = b.lineNumber + 1;
		const displayPath = toDisplayPath(b.filePath);
		const lineText = b.lineText?.trim();
		const labelText = lineText && lineText.length > 0 ? lineText : "(empty line)";

		return {
			label: `$(bookmark) ${labelText}`,
			description: `${fileName}:${lineNum}`,
			detail: displayPath,
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

function normalizeLineForMatch(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

function findBestBookmarkLineMatch(
	document: vscode.TextDocument,
	bookmark: Bookmark,
): number | undefined {
	if (!bookmark.lineText) {
		return undefined;
	}

	const maxLine = document.lineCount - 1;
	if (maxLine < 0) {
		return undefined;
	}

	const rawTarget = bookmark.lineText.trim();
	const normalizedTarget = normalizeLineForMatch(bookmark.lineText);
	if (!rawTarget && !normalizedTarget) {
		return undefined;
	}

	const preferredLine = Math.max(0, Math.min(bookmark.lineNumber, maxLine));
	const currentRaw = document.lineAt(preferredLine).text.trim();
	if (currentRaw === rawTarget) {
		return preferredLine;
	}

	const currentNormalized = normalizeLineForMatch(
		document.lineAt(preferredLine).text,
	);
	if (currentNormalized === normalizedTarget && normalizedTarget.length > 0) {
		return preferredLine;
	}

	let bestRawLine: number | undefined;
	let bestRawDistance = Number.POSITIVE_INFINITY;
	let bestNormalizedLine: number | undefined;
	let bestNormalizedDistance = Number.POSITIVE_INFINITY;

	for (let line = 0; line <= maxLine; line += 1) {
		const text = document.lineAt(line).text;
		const raw = text.trim();
		const distance = Math.abs(line - bookmark.lineNumber);
		if (rawTarget.length > 0 && raw === rawTarget && distance < bestRawDistance) {
			bestRawLine = line;
			bestRawDistance = distance;
		}

		if (normalizedTarget.length > 0) {
			const normalized = normalizeLineForMatch(text);
			if (
				normalized === normalizedTarget &&
				distance < bestNormalizedDistance
			) {
				bestNormalizedLine = line;
				bestNormalizedDistance = distance;
			}
		}
	}

	return bestRawLine ?? bestNormalizedLine;
}

async function goToBookmark(bookmark: Bookmark): Promise<void> {
	try {
		const document = await vscode.workspace.openTextDocument(bookmark.filePath);
		const editor = await vscode.window.showTextDocument(document);

		const fallbackLine = Math.min(bookmark.lineNumber, document.lineCount - 1);
		const matchedLine = findBestBookmarkLineMatch(document, bookmark);
		const lineNumber = matchedLine ?? fallbackLine;
		const safeLineNumber = Math.max(0, lineNumber);
		const range = new vscode.Range(safeLineNumber, 0, safeLineNumber, 0);

		await bookmarkStore.updateBookmarkLocation(
			bookmark.id,
			safeLineNumber,
			document.lineAt(safeLineNumber).text,
		);
		treeDataProvider.refresh();
		decorationManager.updateDecorations(editor);

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
