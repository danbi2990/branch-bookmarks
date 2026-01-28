import * as vscode from "vscode";

/**
 * Utility class for Git operations
 */
export class GitService {
	private gitExtension: vscode.Extension<any> | undefined;
	private _onDidChangeBranch = new vscode.EventEmitter<string>();
	public readonly onDidChangeBranch = this._onDidChangeBranch.event;

	private currentBranch: string = "main";
	private disposables: vscode.Disposable[] = [];

	constructor() {
		this.initialize();
	}

	private async initialize(): Promise<void> {
		this.gitExtension = vscode.extensions.getExtension("vscode.git");

		if (this.gitExtension) {
			if (!this.gitExtension.isActive) {
				await this.gitExtension.activate();
			}

			const git = this.gitExtension.exports.getAPI(1);

			if (git.repositories.length > 0) {
				this.setupRepositoryListeners(git.repositories[0]);
			}

			// Listen for new repositories
			git.onDidOpenRepository((repo: any) => {
				this.setupRepositoryListeners(repo);
			});
		}

		// Initial branch detection
		await this.updateCurrentBranch();
	}

	private setupRepositoryListeners(repository: any): void {
		const stateChangeListener = repository.state.onDidChange(() => {
			this.updateCurrentBranch();
		});
		this.disposables.push(stateChangeListener);
	}

	private async updateCurrentBranch(): Promise<void> {
		const newBranch = await this.getBranchName();
		if (newBranch !== this.currentBranch) {
			this.currentBranch = newBranch;
			this._onDidChangeBranch.fire(this.currentBranch);
		}
	}

	/**
	 * Get the current Git branch name
	 */
	async getBranchName(): Promise<string> {
		if (!this.gitExtension) {
			return "main";
		}

		try {
			const git = this.gitExtension.exports.getAPI(1);
			if (git.repositories.length > 0) {
				const repo = git.repositories[0];
				const head = repo.state.HEAD;
				if (head && head.name) {
					return head.name;
				}
			}
		} catch (error) {
			console.error("Error getting Git branch:", error);
		}

		return "main";
	}

	/**
	 * Get current cached branch name (synchronous)
	 */
	getCurrentBranch(): string {
		return this.currentBranch;
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this._onDidChangeBranch.dispose();
	}
}
