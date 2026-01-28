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
|---------|--------------|-------|
| Toggle Bookmark | `Ctrl+Alt+K` | `Cmd+Alt+K` |
| List Bookmarks (Quick Pick) | `Ctrl+Alt+L` | `Cmd+Alt+L` |

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
|---------|-------------|---------|
| `bookmark.showOtherBranchBookmarks` | Show bookmarks from other Git branches | `true` |
| `bookmark.defaultSortOrder` | Default sort order (`lineNumber` or `dateAdded`) | `lineNumber` |
| `bookmark.gutterIconColor` | Color for bookmark gutter icon | `#007ACC` |

## Development

### Building

```bash
npm install
npm run compile
```

### Running

Press `F5` in VS Code to launch the Extension Development Host.

### Testing

```bash
npm test
```

## License

MIT
