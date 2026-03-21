# CodeDiary — Implementation Guide

Institutional knowledge capture for large codebases undergoing AI-accelerated development. A VSCode extension that builds a living knowledge layer — capturing what developers discover, decide, and verify as AI agents modify code at scale.

**Tagline:** "Know what changed and why."

## Why CodeDiary Exists

AI coding assistants generate changes at unprecedented speed, but on large, mature codebases the bottleneck isn't writing code — it's **comprehension**. When an AI agent modifies a module last touched years ago, the annotation explaining what was discovered and verified is often more valuable than the code change itself.

Existing tools address AI code generation (Cursor, Claude Code, Copilot) and AI code review (CodeRabbit, Copilot Review). Nothing addresses the gap between those stages: **human knowledge capture during AI-driven development**. Developers learn things about the codebase as they work — what a module actually does, why a quirk exists, which regions are dangerous — and that knowledge dies in Slack threads, forgotten PR comments, or tribal memory that walks out the door.

CodeDiary captures the signal and makes it persist.

### Why Not Inline Comments?

Comments pollute the source, have no structure, no lifecycle, no audit trail, and no way to be personal. CodeDiary annotations are a **separate metadata layer** — visible when needed, invisible when not, queryable by category, exportable to PRs, and clearable after merge without touching source code. The dual-store architecture lets developers write candid private notes ("I don't understand this module") alongside shared team knowledge ("this billing loop has an intentional off-by-one for backward compat") — something comments fundamentally cannot do.

### Core Value Propositions

1. **Knowledge capture at point of discovery.** Developers annotate code as they explore and modify it, building structured understanding incrementally across the team.
2. **AI-assisted, not AI-dependent.** AI drafts annotations from diffs so the developer curates rather than writes from scratch. Works fully without AI — manual annotation is first-class.
3. **Shared institutional memory.** Team annotations persist in git alongside the source tree. Developer A annotates a module today; Developer B finds that knowledge six months later.
4. **Critical region awareness.** AI or human-flagged critical regions create a review queue sorted by severity — shifting developers from "review everything" to "focus where it matters."
5. **Audit trail for AI changes.** Structured records of who verified what, when, with what confidence — from individual review markers to PR export.

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

Designed for large teams working on mature, sprawling codebases where no single developer understands the full system:

- **Shared store** (`.codediary/` directory, committed to git): Per-file YAML mirroring the source tree (e.g., `.codediary/src/auth/middleware.ts.yaml`). Merge-conflict-safe — two devs rarely annotate the same file simultaneously. Knowledge persists across team members and survives turnover.
- **Personal store** (`.vscode/codediary.yaml`, gitignored): Single flat YAML file for private notes. Allows candid annotations ("I don't understand this") that shouldn't be committed.
- **DiaryStore facade** merges reads from both stores and routes writes based on a scope picker ("Share with team" vs "Just for me"). Default scope is configurable via `codediary.defaultScope` setting.
- **Narrative** is personal-only (it's your intent description for a PR).
- **clearAll** only clears the personal store to protect team knowledge.

### AI Integration via vscode.lm API

No custom LLM infrastructure. Uses `vscode.lm.selectChatModels()` to leverage whatever language model the user already has installed (GitHub Copilot, Claude, etc.).

- Model picker when multiple models are available, remembers selection for session
- Two scan modes: **diff-based** (changed code only) and **full-file** (for exploring unfamiliar legacy code)
- AI suggestions presented as multi-select quick pick — developer curates, not writes from scratch
- AI features are opt-in; the tool is fully functional with manual-only annotation

### No Static Pattern Detection

Critical logic detection is either:
1. **AI-native** — LLM semantic analysis of code (opt-in, requires a language model)
2. **Manual** — developer flags regions by hand

No AST parsing, no regex rules, no static patterns. This is a deliberate constraint — semantic understanding of "what matters" in a large codebase requires either human judgment or AI reasoning, not pattern matching.

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
| `codediary.searchAnnotations` | Search Annotations | — |
| `codediary.filterByPath` | Filter by File/Folder Path | — |
| `codediary.filterBySeverity` | Filter Critical by Severity | — |
| `codediary.clearFilters` | Clear All Filters | — |
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
- Annotation search across codebase (text, category, file path filters with jump to source)
- AI knowledge feedback loop: existing annotations injected into AI suggestion prompts
- Overlap detection: prevents annotation accumulation, auto-replaces AI-generated duplicates
- Sidebar filtering: filter Change Plan by category + file path, filter Critical Queue by severity + file path
- Unit test suite (209 tests, 98%+ line coverage)

### Deferred (build only if users pull for them)
- Session model: group annotations into named units of work
- GitHub REST API PR comment push
- Configurable export templates
- Custom annotation categories in settings
- Pre-commit/pre-push guard for unreviewed critical regions
- JIRA/Linear ticket linkage
