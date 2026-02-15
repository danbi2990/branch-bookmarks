import * as vscode from "vscode";
import { BookmarkStore } from "./bookmarkStore";
import { GitService } from "./gitService";

/**
 * Manages gutter decorations for bookmarks
 */
export class DecorationManager {
	private currentBranchDecorationType: vscode.TextEditorDecorationType;
	private disposables: vscode.Disposable[] = [];

	constructor(
		private bookmarkStore: BookmarkStore,
		private gitService: GitService,
	) {
		// Create decoration types
		this.currentBranchDecorationType =
			vscode.window.createTextEditorDecorationType({
				gutterIconPath: this.createBookmarkIcon("#007ACC"),
				gutterIconSize: "contain",
			});

		// Update decorations when editor changes
		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor) {
					this.updateDecorations(editor);
				}
			}),
		);

		// Update decorations when bookmarks change
		this.disposables.push(
			this.bookmarkStore.onDidChangeBookmarks(() => {
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					this.updateDecorations(editor);
				}
			}),
		);

		// Update decorations when branch changes
		this.disposables.push(
			this.gitService.onDidChangeBranch(() => {
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					this.updateDecorations(editor);
				}
			}),
		);

		// Initial decoration
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			this.updateDecorations(editor);
		}
	}

	/**
	 * Create a simple bookmark SVG icon
	 */
	private createBookmarkIcon(color: string): vscode.Uri {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="${color}">
            <path d="M3 2v12l5-3 5 3V2H3z"/>
        </svg>`;
		return vscode.Uri.parse(`data:image/svg+xml,${encodeURIComponent(svg)}`);
	}

	/**
	 * Update decorations for the given editor
	 */
	updateDecorations(editor: vscode.TextEditor): void {
		const filePath = editor.document.uri.fsPath;
		const currentBranch = this.gitService.getCurrentBranch();
		const currentBranchBookmarks = this.bookmarkStore.getBookmarksForFile(
			filePath,
			currentBranch,
		);

		const currentBranchRanges: vscode.DecorationOptions[] = [];

		for (const bookmark of currentBranchBookmarks) {
			// Validate line number
			if (bookmark.lineNumber >= editor.document.lineCount) {
				continue;
			}

			const range = new vscode.Range(
				bookmark.lineNumber,
				0,
				bookmark.lineNumber,
				0,
			);

			const decoration: vscode.DecorationOptions = {
				range,
				hoverMessage: new vscode.MarkdownString(
					`**Bookmark** (${bookmark.branchName})\n\n${bookmark.lineText || ""}`,
				),
			};

			currentBranchRanges.push(decoration);
		}

		editor.setDecorations(
			this.currentBranchDecorationType,
			currentBranchRanges,
		);
	}

	clearDecorations(editor: vscode.TextEditor): void {
		editor.setDecorations(this.currentBranchDecorationType, []);
	}

	/**
	 * Refresh decorations for all visible editors
	 */
	refreshAllDecorations(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			this.updateDecorations(editor);
		}
	}

	clearAllDecorations(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			this.clearDecorations(editor);
		}
	}

	dispose(): void {
		this.currentBranchDecorationType.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}
}
