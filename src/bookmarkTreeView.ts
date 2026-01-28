import * as vscode from "vscode";
import * as path from "path";
import { BookmarkStore } from "./bookmarkStore";
import { GitService } from "./gitService";
import { Bookmark, SortOrder } from "./types";

/**
 * Tree item representing a file with bookmarks
 */
class FileTreeItem extends vscode.TreeItem {
	constructor(
		public readonly filePath: string,
		public readonly bookmarkCount: number,
	) {
		super(path.basename(filePath), vscode.TreeItemCollapsibleState.Expanded);
		this.tooltip = filePath;
		this.description = path.dirname(filePath);
		this.iconPath = vscode.ThemeIcon.File;
		this.contextValue = "file";
		this.resourceUri = vscode.Uri.file(filePath);
	}
}

/**
 * Tree item representing a single bookmark
 */
export class BookmarkTreeItem extends vscode.TreeItem {
	constructor(
		public readonly bookmark: Bookmark,
		public readonly isCurrentBranch: boolean,
	) {
		const lineNum = bookmark.lineNumber + 1;
		const label = `Line ${lineNum}`;
		super(label, vscode.TreeItemCollapsibleState.None);

		this.tooltip = `${bookmark.lineText || "No preview"}\nBranch: ${bookmark.branchName}`;
		this.description = bookmark.lineText?.trim().substring(0, 50) || "";
		this.contextValue = "bookmark";

		// Different icon for current vs other branch bookmarks
		if (isCurrentBranch) {
			this.iconPath = new vscode.ThemeIcon(
				"bookmark",
				new vscode.ThemeColor("charts.blue"),
			);
		} else {
			this.iconPath = new vscode.ThemeIcon(
				"bookmark",
				new vscode.ThemeColor("disabledForeground"),
			);
		}

		this.command = {
			command: "bookmark.goToBookmark",
			title: "Go to Bookmark",
			arguments: [bookmark],
		};
	}
}

type TreeItem = FileTreeItem | BookmarkTreeItem;

/**
 * TreeDataProvider for the bookmark view
 */
export class BookmarkTreeDataProvider
	implements vscode.TreeDataProvider<TreeItem>
{
	private _onDidChangeTreeData = new vscode.EventEmitter<
		TreeItem | undefined | null | void
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private sortOrder: SortOrder = "lineNumber";

	constructor(
		private bookmarkStore: BookmarkStore,
		private gitService: GitService,
	) {
		// Load sort order from settings
		const config = vscode.workspace.getConfiguration("bookmark");
		this.sortOrder = config.get<SortOrder>("defaultSortOrder", "lineNumber");
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	setSortOrder(order: SortOrder): void {
		this.sortOrder = order;
		// Save to settings
		vscode.workspace
			.getConfiguration("bookmark")
			.update("defaultSortOrder", order, vscode.ConfigurationTarget.Workspace);
		this.refresh();
	}

	getSortOrder(): SortOrder {
		return this.sortOrder;
	}

	getTreeItem(element: TreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: TreeItem): Promise<TreeItem[]> {
		const currentBranch = this.gitService.getCurrentBranch();
		const showOtherBranches = vscode.workspace
			.getConfiguration("bookmark")
			.get<boolean>("showOtherBranchBookmarks", true);

		if (!element) {
			// Root level: return files
			const allBookmarks = showOtherBranches
				? this.bookmarkStore.getAllBookmarks()
				: this.bookmarkStore.getAllBookmarksForBranch(currentBranch);

			// Group by file
			const fileMap = new Map<string, Bookmark[]>();
			for (const bookmark of allBookmarks) {
				if (!fileMap.has(bookmark.filePath)) {
					fileMap.set(bookmark.filePath, []);
				}
				fileMap.get(bookmark.filePath)!.push(bookmark);
			}

			// Sort files alphabetically
			const sortedFiles = Array.from(fileMap.keys()).sort();

			return sortedFiles.map(
				(filePath) => new FileTreeItem(filePath, fileMap.get(filePath)!.length),
			);
		}

		if (element instanceof FileTreeItem) {
			// Return bookmarks for this file
			let bookmarks = showOtherBranches
				? this.bookmarkStore.getBookmarksForFileAllBranches(element.filePath)
				: this.bookmarkStore.getBookmarksForFile(
						element.filePath,
						currentBranch,
					);

			// Sort bookmarks
			bookmarks = this.bookmarkStore.sortBookmarks(bookmarks, this.sortOrder);

			return bookmarks.map(
				(b) => new BookmarkTreeItem(b, b.branchName === currentBranch),
			);
		}

		return [];
	}
}
