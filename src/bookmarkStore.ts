import * as vscode from "vscode";
import { Bookmark, BookmarkData, SortOrder } from "./types";

const STORAGE_KEY = "bookmarkExtension.bookmarks";
const STORAGE_VERSION = 1;
const KEY_SEPARATOR = "::";

/**
 * Manages bookmark CRUD operations and persistence
 */
export class BookmarkStore {
	private readonly bookmarks: Map<string, Bookmark[]> = new Map();
	private readonly _onDidChangeBookmarks = new vscode.EventEmitter<void>();
	public readonly onDidChangeBookmarks = this._onDidChangeBookmarks.event;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.load();
	}

	/**
	 * Generate a unique ID for a bookmark
	 */
	private generateId(): string {
		return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
	}

	/**
	 * Load bookmarks from workspace state
	 */
	private load(): void {
		const data = this.context.workspaceState.get<BookmarkData>(STORAGE_KEY);
		this.bookmarks.clear();
		if (!data || data.version !== STORAGE_VERSION) {
			return;
		}

		for (const bookmark of data.bookmarks) {
			const key = this.getKey(bookmark.filePath, bookmark.branchName);
			this.getOrCreateBookmarkList(key).push(bookmark);
		}
	}

	/**
	 * Save bookmarks to workspace state
	 */
	private async save(): Promise<void> {
		const data: BookmarkData = {
			bookmarks: this.getAllBookmarks(),
			version: STORAGE_VERSION,
		};
		await this.context.workspaceState.update(STORAGE_KEY, data);
	}

	/**
	 * Get storage key for file + branch combination
	 */
	private getKey(filePath: string, branchName: string): string {
		return `${branchName}${KEY_SEPARATOR}${filePath}`;
	}

	private getOrCreateBookmarkList(key: string): Bookmark[] {
		let bookmarkList = this.bookmarks.get(key);
		if (!bookmarkList) {
			bookmarkList = [];
			this.bookmarks.set(key, bookmarkList);
		}
		return bookmarkList;
	}

	private removeKeyIfEmpty(key: string, bookmarkList: Bookmark[]): void {
		if (bookmarkList.length === 0) {
			this.bookmarks.delete(key);
		}
	}

	private async saveAndNotify(): Promise<void> {
		await this.save();
		this._onDidChangeBookmarks.fire();
	}

	private async removeBookmarkAtIndex(
		key: string,
		bookmarkList: Bookmark[],
		index: number,
	): Promise<boolean> {
		if (index === -1) {
			return false;
		}

		bookmarkList.splice(index, 1);
		this.removeKeyIfEmpty(key, bookmarkList);
		await this.saveAndNotify();
		return true;
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
		const bookmarkList = this.getOrCreateBookmarkList(key);

		// Check if bookmark already exists at this line
		const existing = bookmarkList.find((b) => b.lineNumber === lineNumber);
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

		bookmarkList.push(bookmark);
		await this.saveAndNotify();
		return bookmark;
	}

	/**
	 * Remove a bookmark by ID
	 */
	async remove(id: string): Promise<boolean> {
		for (const [key, bookmarkList] of this.bookmarks.entries()) {
			const index = bookmarkList.findIndex((b) => b.id === id);
			if (await this.removeBookmarkAtIndex(key, bookmarkList, index)) {
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
		return this.removeBookmarkAtIndex(key, bookmarkList, index);
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
			if (key.endsWith(`${KEY_SEPARATOR}${filePath}`)) {
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
			if (key.startsWith(`${branchName}${KEY_SEPARATOR}`)) {
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
		const bookmarksToRemove = new Set<string>();

		for (const change of changes) {
			const startLine = change.range.start.line;
			const endLine = change.range.end.line;
			const linesRemoved = endLine - startLine;
			const linesAdded = change.text.split("\n").length - 1;
			const lineDelta = linesAdded - linesRemoved;
			const isPureInsertion =
				linesRemoved === 0 &&
				change.range.start.line === change.range.end.line &&
				change.range.start.character === change.range.end.character;
			const insertsBeforeLineAtStart =
				isPureInsertion &&
				change.range.start.character === 0 &&
				!change.text.startsWith("\n") &&
				linesAdded > 0;
			const isDeletionOnly = linesRemoved > 0 && change.text.length === 0;
			const deletedEndLine =
				change.range.end.character === 0 && endLine > startLine
					? endLine - 1
					: endLine;

			for (const bookmark of bookmarkList) {
				// Skip bookmarks already marked for removal
				if (bookmarksToRemove.has(bookmark.id)) {
					continue;
				}

				if (lineDelta !== 0 || linesRemoved > 0) {
					if (
						bookmark.lineNumber > deletedEndLine ||
						(insertsBeforeLineAtStart && bookmark.lineNumber === startLine)
					) {
						// Bookmark is after the change - adjust by line delta
						bookmark.lineNumber += lineDelta;
						modified = true;
					} else if (
						bookmark.lineNumber >= startLine &&
						bookmark.lineNumber <= deletedEndLine &&
						linesRemoved > 0
					) {
						if (isDeletionOnly) {
							// Pure deletion: remove bookmarks inside the deleted range.
							bookmarksToRemove.add(bookmark.id);
							modified = true;
						} else {
							// Replacement (e.g. format document): preserve bookmark by
							// mapping it to the closest resulting line in the replaced block.
							const relativeLine = bookmark.lineNumber - startLine;
							const replacementEndLine = startLine + linesAdded;
							const newLine = Math.min(
								startLine + Math.max(relativeLine, 0),
								replacementEndLine,
							);
							if (newLine !== bookmark.lineNumber) {
								bookmark.lineNumber = newLine;
								modified = true;
							}
						}
					}
				}
			}
		}

		// Remove bookmarks that were in deleted lines
		if (bookmarksToRemove.size > 0) {
			const remainingBookmarks = bookmarkList.filter(
				(bookmark) => !bookmarksToRemove.has(bookmark.id),
			);
			bookmarkList.length = 0;
			bookmarkList.push(...remainingBookmarks);
		}

		this.removeKeyIfEmpty(key, bookmarkList);

		if (modified) {
			await this.saveAndNotify();
		}
	}

	/**
	 * Update file path when file is renamed/moved
	 */
	async updateFilePath(oldPath: string, newPath: string): Promise<void> {
		let modified = false;
		const keysToUpdate: [string, string][] = [];

		for (const key of this.bookmarks.keys()) {
			if (key.endsWith(`${KEY_SEPARATOR}${oldPath}`)) {
				keysToUpdate.push([
					key,
					key.replace(
						`${KEY_SEPARATOR}${oldPath}`,
						`${KEY_SEPARATOR}${newPath}`,
					),
				]);
			}
		}

		for (const [oldKey, newKey] of keysToUpdate) {
			if (oldKey === newKey) {
				continue;
			}

			const bookmarkList = this.bookmarks.get(oldKey);
			if (!bookmarkList) {
				continue;
			}

			for (const bookmark of bookmarkList) {
				bookmark.filePath = newPath;
			}
			this.bookmarks.delete(oldKey);

			const existingList = this.bookmarks.get(newKey);
			if (!existingList) {
				this.bookmarks.set(newKey, bookmarkList);
			} else {
				const seenIds = new Set(existingList.map((bookmark) => bookmark.id));
				for (const bookmark of bookmarkList) {
					if (!seenIds.has(bookmark.id)) {
						existingList.push(bookmark);
						seenIds.add(bookmark.id);
					}
				}
			}
			modified = true;
		}

		if (modified) {
			await this.saveAndNotify();
		}
	}

	/**
	 * Update a bookmark's line number and preview text
	 */
	async updateBookmarkLocation(
		id: string,
		lineNumber: number,
		lineText?: string,
	): Promise<boolean> {
		for (const bookmarkList of this.bookmarks.values()) {
			const bookmark = bookmarkList.find((b) => b.id === id);
			if (!bookmark) {
				continue;
			}

			if (
				bookmark.lineNumber === lineNumber &&
				bookmark.lineText === lineText
			) {
				return false;
			}

			bookmark.lineNumber = lineNumber;
			bookmark.lineText = lineText;
			await this.saveAndNotify();
			return true;
		}
		return false;
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
					if (invalidBookmarks.length > 0) {
						removedCount += invalidBookmarks.length;
						const remainingBookmarks = bookmarkList.filter(
							(bookmark) => bookmark.lineNumber < lineCount,
						);
						bookmarkList.length = 0;
						bookmarkList.push(...remainingBookmarks);
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
			await this.saveAndNotify();
		}

		return removedCount;
	}

	/**
	 * Clear all bookmarks
	 */
	async clearAll(): Promise<void> {
		this.bookmarks.clear();
		await this.saveAndNotify();
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
