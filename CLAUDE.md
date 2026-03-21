# CodeDiary — Implementation Guide

A VSCode extension for journaling AI-assisted code changes. Captures intent, decision-making, and implementation journey before PR.

**Tagline:** "Reflect before you ship."

## Architecture Overview

```
codediary/
├── src/
│   ├── extension.ts              # Activation, command registration
│   ├── models/
│   │   ├── annotation.ts         # Annotation data model + 7 categories
│   │   ├── reviewMarker.ts       # Human review marker model
│   │   └── criticalFlag.ts       # Critical region flag + resolution model
│   ├── storage/
│   │   ├── diaryStore.ts         # Facade: merges shared + personal stores
│   │   ├── sharedStore.ts        # Per-file YAML in .codediary/ (git-committed)
│   │   └── yamlStore.ts          # Single YAML in .vscode/ (personal, gitignored)
│   ├── providers/
│   │   ├── annotationDecorator.ts    # Inline text + colored backgrounds per category
│   │   ├── reviewMarkerDecorator.ts  # Green checkmark on reviewed lines
│   │   └── criticalDecorator.ts      # Red/green shield on critical regions
│   ├── views/
│   │   ├── changePlanProvider.ts     # TreeView sidebar: annotations grouped by file
│   │   ├── criticalQueueProvider.ts  # TreeView: sorted critical review queue
│   │   └── coverageBar.ts           # Status bar: annotation + review summary
│   ├── commands/
│   │   ├── annotate.ts           # Add/edit/delete annotations with scope picker
│   │   ├── markReviewed.ts       # Mark lines/files as human-reviewed
│   │   ├── markCritical.ts       # Flag critical regions, resolve/remove
│   │   └── exportPR.ts           # Generate markdown, set narrative, clear all
│   ├── ai/
│   │   ├── lmService.ts          # vscode.lm API wrapper with model picker
│   │   ├── diaryGenerator.ts     # AI-suggested diary entries from diffs
│   │   └── criticalDetector.ts   # AI critical logic detection (diff + full file)
│   └── export/
│       └── markdownExport.ts     # PR description markdown generation
├── test/                         # Vitest unit tests (160 tests, 98%+ coverage)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .vscode/
    └── launch.json
```

## Key Design Decisions

### Shared + Personal Storage (Dual-Store Architecture)

Designed for large teams (2000+ developers on legacy codebases):

- **Shared store** (`.codediary/` directory, committed to git): Per-file YAML mirroring the source tree (e.g., `.codediary/src/auth/middleware.ts.yaml`). This keeps merge conflicts scoped to individual files — two devs rarely annotate the same file at once.
- **Personal store** (`.vscode/codediary.yaml`, gitignored): Single flat YAML file for private notes.
- **DiaryStore facade** merges reads from both stores and routes writes based on a scope picker ("Share with team" vs "Just for me"). Default scope is configurable via `codediary.defaultScope` setting.
- **Narrative** is personal-only (it's your intent description for a PR).
- **clearAll** only clears the personal store to protect team data.

### AI Integration via vscode.lm API

No custom LLM infrastructure. Uses `vscode.lm.selectChatModels()` to leverage whatever language model the user already has installed (GitHub Copilot, Claude, etc.).

- Model picker when multiple models are available, remembers selection for session
- Two scan modes: **diff-based** (changed code only) and **full-file** (for legacy code exploration)
- AI suggestions presented as multi-select quick pick — user decides what to keep

### No Static Pattern Detection

Critical logic detection is either:
1. **AI-native** — LLM semantic analysis of code (opt-in, requires a language model)
2. **Manual** — developer flags regions by hand

No AST parsing, no regex rules, no static patterns. This is a deliberate constraint.

### Critical Flag Resolution

Critical flags support a full resolution lifecycle:
- Flag with severity (critical / high / medium) and description
- Resolve with comment, resolver identity, and timestamp
- Remove entirely
- Queue sorted: unreviewed first, then by severity

## Commands

| Command | Title | Keybinding |
|---------|-------|------------|
| `codediary.addAnnotation` | Add Annotation | `Cmd+Shift+J` |
| `codediary.editAnnotation` | Edit Annotation | — |
| `codediary.deleteAnnotation` | Delete Annotation | — |
| `codediary.markReviewed` | Mark as Reviewed | `Cmd+Shift+K` |
| `codediary.markFileReviewed` | Mark File as Reviewed | — |
| `codediary.unmarkReviewed` | Unmark Reviewed | — |
| `codediary.markCritical` | Mark as Critical | — |
| `codediary.resolveCritical` | Resolve Critical Flag | — |
| `codediary.removeCritical` | Remove Critical Flag | — |
| `codediary.exportPR` | Export to PR (Clipboard) | — |
| `codediary.setNarrative` | Set Change Narrative | — |
| `codediary.clearAll` | Clear All Annotations | — |
| `codediary.filterByCategory` | Filter by Category | — |
| `codediary.suggestDiary` | Suggest Diary Entries (Current File) | — |
| `codediary.suggestDiaryAll` | Suggest Diary Entries (All Changes) | — |
| `codediary.scanCritical` | Scan Changes for Critical Logic (Diff Only) | — |
| `codediary.scanCriticalAll` | Scan All Uncommitted Changes (Diff Only) | — |
| `codediary.scanFile` | Scan Entire File for Critical Logic (Full File) | — |
| `codediary.changeModel` | Change AI Model | — |

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `codediary.storagePath` | string | `.vscode/codediary.yaml` | Personal storage file path |
| `codediary.highlightUnreviewed` | boolean | `true` | Highlight unreviewed lines |
| `codediary.defaultScope` | `shared` \| `personal` | `shared` | Where new annotations are stored |

## Development

```bash
npm run compile    # TypeScript compilation
npm run build      # esbuild bundle
npm run test       # Vitest unit tests
npm run test:coverage  # Tests with coverage report
npm run lint       # Type check without emit
```

Press `F5` in VSCode to launch the Extension Development Host for manual testing.

## Implementation Status

### Complete (Phase 1 + Phase 2 partial)
- Inline annotations with 7 categories and scope picker
- Human review markers with merge logic for overlapping ranges
- Critical flag lifecycle (flag, resolve with comment, remove)
- AI-suggested diary entries from git diffs (via vscode.lm)
- AI critical logic detection: diff-based and full-file scanning
- Change Plan sidebar with file grouping and category filter
- Critical Review Queue sorted by severity
- Status bar with coverage summary
- PR export to clipboard (structured markdown)
- Shared/personal dual-store architecture
- Unit test suite (160 tests, 98%+ line coverage)

### Remaining (Phase 2)
- GitHub REST API PR comment push
- Configurable export templates
- Custom annotation categories in settings
- Pre-commit/pre-push guard for unreviewed critical regions

### Future (Phase 3-4)
- Session model: group annotations into named units of work
- Session timeline view and batch summaries
- Feature-level implementation narratives
- JIRA/Linear ticket linkage
