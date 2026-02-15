# Bookmark Extension for VS Code

A powerful bookmark extension that allows you to bookmark specific lines in your code files for easy navigation, with Git branch support.

## Features

- **Add/Remove/Toggle Bookmarks** - Quickly bookmark lines with keyboard shortcuts
- **TreeView Panel** - Browse all bookmarks in the Explorer sidebar
- **Quick Pick Menu** - Fuzzy search through all bookmarks
- **Git Branch Support** - Bookmarks are scoped to Git branches
- **Visual Indicators** - Gutter icons show bookmarked lines
- **Smart Line Tracking** - Bookmarks update when lines are added/removed
- **File Rename Support** - Bookmarks follow renamed/moved files
- **Auto-cleanup** - Invalid bookmarks are automatically removed

## Usage

### Keyboard Shortcuts

| Command | Windows/Linux | macOS |
| --- | --- | --- |
| Toggle Bookmark | `F3` | `F3` |
| List Bookmarks (Quick Pick) | `Shift+F3` | `Shift+F3` |

### Commands

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- `Bookmark: Add Bookmark` - Add bookmark at current line
- `Bookmark: Remove Bookmark` - Remove bookmark at current line
- `Bookmark: Toggle Bookmark` - Toggle bookmark at current line
- `Bookmark: List Bookmarks (Quick Pick)` - Show all bookmarks in a quick pick menu
- `Bookmark: Change Sort Order` - Change how bookmarks are sorted
- `Bookmark: Clear All Bookmarks` - Remove all bookmarks
- `Bookmark: Refresh Bookmarks` - Refresh the bookmark view

### TreeView

The Bookmarks panel appears in the Explorer sidebar. From there you can:

- View all bookmarks grouped by file
- Click a bookmark to navigate to it
- Remove bookmarks using the inline button
- Change sort order using the title bar button

## Settings

| Setting | Description | Default |
| --- | --- | --- |
| `bookmark.defaultSortOrder` | Default sort order (`lineNumber` or `dateAdded`) | `lineNumber` |
| `bookmark.gutterIconColor` | Color for bookmark gutter icon | `#007ACC` |
| `bookmark.branchTransitionDelayMs` | Line-tracking suspend time after Git branch changes (ms) | `500` |

## Development

### Building

```bash
npm install
npm run compile
```

### Running

Press `F5` in VS Code to launch the Extension Development Host.

### Testing

This extension uses VS Code integration tests with `@vscode/test-cli` and `@vscode/test-electron`.
The test runner is configured in `.vscode-test.js` and opens the fixture workspace at `src/test/fixture/workspace`.

```bash
npm test
```

What the current integration tests cover:

- Toggle behavior (`bookmark.toggle`) adds and removes bookmarks at the cursor line
- Line tracking behavior shifts bookmark line numbers after text is inserted above a bookmark

Notes:

- On first run, the test runner may download a VS Code test binary into `.vscode-test/`
- Tests assert against bookmark store state (model), not editor decoration UI

## License

MIT
