import * as vscode from "vscode";

export function toDisplayPath(filePath: string): string {
	return vscode.workspace.asRelativePath(vscode.Uri.file(filePath), false);
}
