# Branch Bookmarks for VS Code

Branch-aware bookmarks for VS Code.

`Branch Bookmarks` lets you pin lines while working across Git branches, then jump back quickly from the sidebar or quick pick.

## Features

- Branch-scoped bookmarks
- Toggle bookmark at cursor line
- Sidebar view in Explorer (`Bookmarks`)
- Quick pick bookmark list
- Gutter icon decoration
- Automatic line tracking on edits
- Bookmark cleanup for deleted/out-of-range files/lines
- File rename/move tracking

## Sorting Behavior

- Sidebar (`Bookmarks` view): shows bookmarks from the current branch only, groups by file, sorts files alphabetically, and sorts bookmarks in each file by line number (ascending).
- Quick Pick (`Bookmark: List Bookmarks`): shows bookmarks from the current branch sorted by recently added first.

## Keyboard Shortcuts

| Action | Shortcut | Command ID |
| --- | --- | --- |
| Toggle Bookmark | `F3` | `bookmark.toggle` |
| List Bookmarks (Quick Pick) | `Shift+F3` | `bookmark.listQuickPick` |
| Focus Bookmarks Sidebar | `Cmd+4` (macOS), `Ctrl+4` (Windows/Linux) | `bookmark.focusSidebar` |

## Commands

| Command Palette Label | Command ID |
| --- | --- |
| `Bookmark: Toggle Bookmark` | `bookmark.toggle` |
| `Bookmark: List Bookmarks (Quick Pick)` | `bookmark.listQuickPick` |
| `Bookmark: Focus Bookmarks Sidebar` | `bookmark.focusSidebar` |
| `Bookmark: Clear All Bookmarks` | `bookmark.clearAll` |
| `Bookmark: Refresh Bookmarks` | `bookmark.refresh` |

## Settings

| Setting | Description | Default |
| --- | --- | --- |
| `bookmark.gutterIconColor` | Color for bookmark gutter icon | `#007ACC` |
| `bookmark.branchTransitionDelayMs` | Suspend duration for line tracking after branch change (ms) | `500` |

## Development

```bash
npm install
npm run compile
npm test
```

### Local Install

```bash
npm run install:local
```

This script packages a VSIX and installs it into local VS Code.

## License

MIT. See `LICENSE`.
