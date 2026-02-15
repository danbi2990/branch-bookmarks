import * as vscode from "vscode";
import * as path from "path";
import { BookmarkStore } from "./bookmarkStore";
import { GitService } from "./gitService";
import { Bookmark } from "./types";
import { toDisplayPath } from "./pathDisplay";

/**
 * Tree item representing a file with bookmarks
 */
class FileTreeItem extends vscode.TreeItem {
	constructor(
		public readonly filePath: string,
		public readonly bookmarkCount: number,
	) {
		const displayPath = toDisplayPath(filePath);
		super(path.basename(displayPath), vscode.TreeItemCollapsibleState.Expanded);
		const displayDir = path.dirname(displayPath);
		this.tooltip = displayPath;
		this.description = displayDir === "." ? "" : displayDir;
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
		const lineText = bookmark.lineText?.trim();
		const label = lineText && lineText.length > 0 ? lineText : "(empty line)";
		super(label, vscode.TreeItemCollapsibleState.None);

		this.tooltip = `Line ${lineNum}\n${bookmark.lineText || "No preview"}\nBranch: ${bookmark.branchName}`;
		this.description = `Line ${lineNum}`;
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

	constructor(
		private bookmarkStore: BookmarkStore,
		private gitService: GitService,
	) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: TreeItem): Promise<TreeItem[]> {
		const currentBranch = this.gitService.getCurrentBranch();

		if (!element) {
			// Root level: return files
			const allBookmarks =
				this.bookmarkStore.getAllBookmarksForBranch(currentBranch);

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
			let bookmarks = this.bookmarkStore.getBookmarksForFile(
				element.filePath,
				currentBranch,
			);

			// Sidebar order is fixed by line number.
			bookmarks = this.bookmarkStore.sortBookmarks(bookmarks, "lineNumber");

			return bookmarks.map((b) => new BookmarkTreeItem(b, true));
		}

		return [];
	}
}
