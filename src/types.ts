/**
 * Represents a single bookmark
 */
export interface Bookmark {
	/** Unique identifier for the bookmark */
	id: string;
	/** Absolute file path */
	filePath: string;
	/** Line number (0-based) */
	lineNumber: number;
	/** Timestamp when bookmark was created */
	createdAt: number;
	/** Git branch name where bookmark was created */
	branchName: string;
	/** Preview text of the bookmarked line */
	lineText?: string;
}

/**
 * Sort order options for bookmarks
 */
export type SortOrder = "lineNumber" | "dateAdded";

/**
 * Serializable bookmark data for persistence
 */
export interface BookmarkData {
	bookmarks: Bookmark[];
	version: number;
}
