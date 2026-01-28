import * as vscode from "vscode";
import { Bookmark, BookmarkData, SortOrder } from "./types";

const STORAGE_KEY = "bookmarkExtension.bookmarks";
const STORAGE_VERSION = 1;

/**
 * Manages bookmark CRUD operations and persistence
 */
export class BookmarkStore {
	private bookmarks: Map<string, Bookmark[]> = new Map();
	private context: vscode.ExtensionContext;
	private _onDidChangeBookmarks = new vscode.EventEmitter<void>();
	public readonly onDidChangeBookmarks = this._onDidChangeBookmarks.event;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.load();
	}

	/**
	 * Generate a unique ID for a bookmark
	 */
	private generateId(): string {
		return Date.now().toString(36) + Math.random().toString(36).substr(2);
	}

	/**
	 * Load bookmarks from workspace state
	 */
	private load(): void {
		const data = this.context.workspaceState.get<BookmarkData>(STORAGE_KEY);
		if (data && data.version === STORAGE_VERSION) {
			this.bookmarks.clear();
			for (const bookmark of data.bookmarks) {
				const key = this.getKey(bookmark.filePath, bookmark.branchName);
				if (!this.bookmarks.has(key)) {
					this.bookmarks.set(key, []);
				}
				this.bookmarks.get(key)!.push(bookmark);
			}
		}
	}

	/**
	 * Save bookmarks to workspace state
	 */
	private async save(): Promise<void> {
		const allBookmarks: Bookmark[] = [];
		for (const bookmarkList of this.bookmarks.values()) {
			allBookmarks.push(...bookmarkList);
		}
		const data: BookmarkData = {
			bookmarks: allBookmarks,
			version: STORAGE_VERSION,
		};
		await this.context.workspaceState.update(STORAGE_KEY, data);
	}

	/**
	 * Get storage key for file + branch combination
	 */
	private getKey(filePath: string, branchName: string): string {
		return `${branchName}::${filePath}`;
	}

	/**
	 * Add a new bookmark
	 */
	async add(
		filePath: string,
		lineNumber: number,
		branchName: string,
		lineText?: string,
	): Promise<Bookmark> {
		const key = this.getKey(filePath, branchName);
		if (!this.bookmarks.has(key)) {
			this.bookmarks.set(key, []);
		}

		// Check if bookmark already exists at this line
		const existing = this.bookmarks
			.get(key)!
			.find((b) => b.lineNumber === lineNumber);
		if (existing) {
			return existing;
		}

		const bookmark: Bookmark = {
			id: this.generateId(),
			filePath,
			lineNumber,
			createdAt: Date.now(),
			branchName,
			lineText,
		};

		this.bookmarks.get(key)!.push(bookmark);
		await this.save();
		this._onDidChangeBookmarks.fire();
		return bookmark;
	}

	/**
	 * Remove a bookmark by ID
	 */
	async remove(id: string): Promise<boolean> {
		for (const [key, bookmarkList] of this.bookmarks.entries()) {
			const index = bookmarkList.findIndex((b) => b.id === id);
			if (index !== -1) {
				bookmarkList.splice(index, 1);
				if (bookmarkList.length === 0) {
					this.bookmarks.delete(key);
				}
				await this.save();
				this._onDidChangeBookmarks.fire();
				return true;
			}
		}
		return false;
	}

	/**
	 * Remove bookmark at specific line
	 */
	async removeAtLine(
		filePath: string,
		lineNumber: number,
		branchName: string,
	): Promise<boolean> {
		const key = this.getKey(filePath, branchName);
		const bookmarkList = this.bookmarks.get(key);
		if (!bookmarkList) {
			return false;
		}

		const index = bookmarkList.findIndex((b) => b.lineNumber === lineNumber);
		if (index !== -1) {
			bookmarkList.splice(index, 1);
			if (bookmarkList.length === 0) {
				this.bookmarks.delete(key);
			}
			await this.save();
			this._onDidChangeBookmarks.fire();
			return true;
		}
		return false;
	}

	/**
	 * Check if a bookmark exists at the given line
	 */
	hasBookmarkAtLine(
		filePath: string,
		lineNumber: number,
		branchName: string,
	): boolean {
		const key = this.getKey(filePath, branchName);
		const bookmarkList = this.bookmarks.get(key);
		return bookmarkList?.some((b) => b.lineNumber === lineNumber) ?? false;
	}

	/**
	 * Get bookmark at specific line
	 */
	getBookmarkAtLine(
		filePath: string,
		lineNumber: number,
		branchName: string,
	): Bookmark | undefined {
		const key = this.getKey(filePath, branchName);
		const bookmarkList = this.bookmarks.get(key);
		return bookmarkList?.find((b) => b.lineNumber === lineNumber);
	}

	/**
	 * Get all bookmarks for a file on a specific branch
	 */
	getBookmarksForFile(filePath: string, branchName: string): Bookmark[] {
		const key = this.getKey(filePath, branchName);
		return this.bookmarks.get(key) ?? [];
	}

	/**
	 * Get all bookmarks for a file across all branches
	 */
	getBookmarksForFileAllBranches(filePath: string): Bookmark[] {
		const result: Bookmark[] = [];
		for (const [key, bookmarkList] of this.bookmarks.entries()) {
			if (key.endsWith(`::${filePath}`)) {
				result.push(...bookmarkList);
			}
		}
		return result;
	}

	/**
	 * Get all bookmarks for current branch
	 */
	getAllBookmarksForBranch(branchName: string): Bookmark[] {
		const result: Bookmark[] = [];
		for (const [key, bookmarkList] of this.bookmarks.entries()) {
			if (key.startsWith(`${branchName}::`)) {
				result.push(...bookmarkList);
			}
		}
		return result;
	}

	/**
	 * Get all bookmarks across all branches
	 */
	getAllBookmarks(): Bookmark[] {
		const result: Bookmark[] = [];
		for (const bookmarkList of this.bookmarks.values()) {
			result.push(...bookmarkList);
		}
		return result;
	}

	/**
	 * Update line numbers when file content changes
	 */
	async updateLineNumbers(
		filePath: string,
		branchName: string,
		changes: vscode.TextDocumentContentChangeEvent[],
	): Promise<void> {
		const key = this.getKey(filePath, branchName);
		const bookmarkList = this.bookmarks.get(key);
		if (!bookmarkList || bookmarkList.length === 0) {
			return;
		}

		let modified = false;
		for (const change of changes) {
			const startLine = change.range.start.line;
			const endLine = change.range.end.line;
			const linesRemoved = endLine - startLine;
			const linesAdded = change.text.split("\n").length - 1;
			const lineDelta = linesAdded - linesRemoved;

			if (lineDelta !== 0) {
				for (const bookmark of bookmarkList) {
					if (bookmark.lineNumber > endLine) {
						bookmark.lineNumber += lineDelta;
						modified = true;
					} else if (
						bookmark.lineNumber >= startLine &&
						bookmark.lineNumber <= endLine &&
						linesRemoved > 0
					) {
						// Bookmark is within deleted range - move to start of change
						bookmark.lineNumber = startLine;
						modified = true;
					}
				}
			}
		}

		if (modified) {
			await this.save();
			this._onDidChangeBookmarks.fire();
		}
	}

	/**
	 * Update file path when file is renamed/moved
	 */
	async updateFilePath(oldPath: string, newPath: string): Promise<void> {
		let modified = false;
		const keysToUpdate: [string, string][] = [];

		for (const key of this.bookmarks.keys()) {
			if (key.endsWith(`::${oldPath}`)) {
				keysToUpdate.push([key, key.replace(`::${oldPath}`, `::${newPath}`)]);
			}
		}

		for (const [oldKey, newKey] of keysToUpdate) {
			const bookmarkList = this.bookmarks.get(oldKey)!;
			for (const bookmark of bookmarkList) {
				bookmark.filePath = newPath;
			}
			this.bookmarks.delete(oldKey);
			this.bookmarks.set(newKey, bookmarkList);
			modified = true;
		}

		if (modified) {
			await this.save();
			this._onDidChangeBookmarks.fire();
		}
	}

	/**
	 * Remove bookmarks for files that no longer exist
	 */
	async cleanup(): Promise<number> {
		let removedCount = 0;
		const keysToDelete: string[] = [];

		for (const [key, bookmarkList] of this.bookmarks.entries()) {
			const filePath = bookmarkList[0]?.filePath;
			if (filePath) {
				try {
					await vscode.workspace.fs.stat(vscode.Uri.file(filePath));

					// File exists, check line numbers
					const document = await vscode.workspace.openTextDocument(
						vscode.Uri.file(filePath),
					);
					const lineCount = document.lineCount;

					const invalidBookmarks = bookmarkList.filter(
						(b) => b.lineNumber >= lineCount,
					);
					for (const invalid of invalidBookmarks) {
						const index = bookmarkList.indexOf(invalid);
						if (index !== -1) {
							bookmarkList.splice(index, 1);
							removedCount++;
						}
					}

					if (bookmarkList.length === 0) {
						keysToDelete.push(key);
					}
				} catch {
					// File doesn't exist, remove all bookmarks for it
					removedCount += bookmarkList.length;
					keysToDelete.push(key);
				}
			}
		}

		for (const key of keysToDelete) {
			this.bookmarks.delete(key);
		}

		if (removedCount > 0) {
			await this.save();
			this._onDidChangeBookmarks.fire();
		}

		return removedCount;
	}

	/**
	 * Clear all bookmarks
	 */
	async clearAll(): Promise<void> {
		this.bookmarks.clear();
		await this.save();
		this._onDidChangeBookmarks.fire();
	}

	/**
	 * Sort bookmarks by specified order
	 */
	sortBookmarks(bookmarks: Bookmark[], sortOrder: SortOrder): Bookmark[] {
		const sorted = [...bookmarks];
		if (sortOrder === "lineNumber") {
			sorted.sort((a, b) => {
				if (a.filePath !== b.filePath) {
					return a.filePath.localeCompare(b.filePath);
				}
				return a.lineNumber - b.lineNumber;
			});
		} else {
			sorted.sort((a, b) => b.createdAt - a.createdAt);
		}
		return sorted;
	}
}
