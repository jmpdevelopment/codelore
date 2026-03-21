# CodeDiary — Implementation Plan

A VSCode extension for journaling AI-assisted code changes. Captures intent, decision-making, and implementation journey before PR.

**Tagline:** "Reflect before you ship."

## Architecture Overview

```
codediary/
├── src/
│   ├── extension.ts              # Activation, command registration
│   ├── models/
│   │   ├── annotation.ts         # Annotation data model + types
│   │   ├── reviewMarker.ts       # Human review marker model
│   │   └── criticalFlag.ts       # Critical region flag model
│   ├── storage/
│   │   └── yamlStore.ts          # YAML read/write for .vscode/codediary.yaml
│   ├── providers/
│   │   ├── annotationDecorator.ts    # Gutter icons + inline text decorations
│   │   ├── reviewMarkerDecorator.ts  # Green checkmark gutter for reviewed lines
│   │   └── unreviewed Highlight.ts   # Warm background tint on unreviewed lines
│   ├── views/
│   │   ├── changePlanProvider.ts     # TreeView sidebar: annotations grouped by file
│   │   ├── criticalQueueProvider.ts  # TreeView: unreviewed critical regions
│   │   └── coverageBar.ts           # Status bar: review coverage %
│   ├── commands/
│   │   ├── annotate.ts           # Add/edit/delete annotations (context menu + shortcut)
│   │   ├── markReviewed.ts       # Mark lines/files as human-reviewed
│   │   ├── markCritical.ts       # Manually flag regions as critical
│   │   └── exportPR.ts           # Generate markdown + copy to clipboard
│   └── export/
│       └── markdownExport.ts     # PR description markdown generation
├── package.json                  # Extension manifest, commands, menus, keybindings
├── tsconfig.json
└── .vscode/
    └── launch.json               # Extension debug config
```

## Implementation Phases

### Phase 1: MVP — Core Journaling (6-8 weeks)

**Step 1: Scaffold**
- `yo code` TypeScript extension scaffold
- Configure package.json: extension ID `codediary`, activation events, contributes section
- Verify diff view API access (TextEditor, diff URI schemes)

**Step 2: Data Model + Storage**
- Define TypeScript interfaces for Annotation, ReviewMarker, CriticalFlag (per spec schemas)
- Annotation categories enum: `verified | needs_review | modified | confused | hallucination | intent | accepted`
- Annotation source enum: `manual | ai_suggested | ai_accepted`
- YAML storage layer using `js-yaml`: read/write `.vscode/codediary.yaml`
- File watcher for external edits to the YAML file

**Step 3: Inline Annotations (F1 + F2)**
- Right-click context menu in editor/diff view → "CodeDiary: Add Annotation"
- Quick-pick for category selection (no modal)
- Input box for free-text annotation body
- Gutter icons per category (color-coded: green/orange/blue/yellow/red/purple/gray)
- Inline decoration showing first line of annotation text
- Keyboard shortcut: `Ctrl+Shift+J` / `Cmd+Shift+J`
- Click gutter icon to expand/edit annotation
- Delete annotation command

**Step 4: Human Review Markers (F8)**
- "Mark as Reviewed" command for selected range or entire file
- Green checkmark gutter decoration on reviewed lines
- Store reviewer git identity + timestamp
- Unreviewed line highlighting (subtle warm background tint via `editor.background` decoration)
- Bulk actions: "Mark file as reviewed", "Mark all test files as reviewed"

**Step 5: Review Coverage (F8 continued)**
- Status bar item showing "X% reviewed (Y/Z files, A/B lines)"
- Sidebar coverage summary at top of change plan
- Calculate coverage from review markers vs. git diff changed lines

**Step 6: Critical Logic — Manual Marking Only (F9, modified)**
- "Mark as Critical" command for selected range
- Red shield gutter icon on unreviewed critical lines
- Green shield on reviewed critical lines
- Severity picker: critical | high | medium
- Critical Review Queue in sidebar (sorted by severity)
- NOTE: No static pattern detection. AI-native detection deferred to Phase 2.

**Step 7: Change Plan Sidebar (F3)**
- TreeView provider grouped by file → annotation category
- Summary stats at top
- Click to jump to annotation location
- Filter by category
- Editable narrative field for overall change description

**Step 8: PR Export (F4, clipboard only)**
- Generate structured markdown from change plan:
  - Intent / narrative
  - What was changed (by file)
  - Review coverage stats
  - Unreviewed files list
  - Critical regions status
  - Annotations marked "needs_review" or "confused"
- One-click copy to clipboard
- Template: hardcoded markdown format (configurable templates in Phase 2)

### Phase 2: AI-Assisted Journaling (10-14 weeks)

- AI-suggested diary entries from diffs + commit context
- One-click accept/edit ghost text flow
- AI-native critical logic detection (LLM semantic analysis, opt-in)
- LLM provider config (Claude API, OpenAI, local ollama)
- Agent context integration (Claude Code sessions, Cursor logs)
- GitHub REST API PR comment push
- Configurable export templates
- Custom annotation categories in settings
- Pre-commit/pre-push guard for unreviewed critical regions

### Phase 3: Session Tracking (16-20 weeks)

- Session model: group annotations into named units of work
- Session timeline view
- Batch session summaries (AI-generated)
- Session-to-PR mapping

### Phase 4: Feature Narrative (24-28 weeks)

- Sessions → feature-level implementation story
- Auto-generated feature summaries
- JIRA/Linear ticket linkage
- Team analytics dashboard

## Key Constraints

- **No static pattern detection / AST rules** — critical logic is AI-native or manual only
- **Local-first** — all data in `.vscode/codediary.yaml`, no cloud dependency
- **Privacy-first** — no code sent to LLM without explicit opt-in config
- **Warm, reflective tone** — this is a journaling tool, not a linting tool
- **Storage format:** Human-readable YAML for easy manual editing and git diffing

## Commands (package.json contributes)

| Command | Title | Keybinding |
|---------|-------|------------|
| `codediary.addAnnotation` | CodeDiary: Add Annotation | `Ctrl+Shift+J` / `Cmd+Shift+J` |
| `codediary.editAnnotation` | CodeDiary: Edit Annotation | — |
| `codediary.deleteAnnotation` | CodeDiary: Delete Annotation | — |
| `codediary.markReviewed` | CodeDiary: Mark as Reviewed | — |
| `codediary.markFileReviewed` | CodeDiary: Mark File as Reviewed | — |
| `codediary.markCritical` | CodeDiary: Mark as Critical | — |
| `codediary.exportPR` | CodeDiary: Export to PR (Clipboard) | — |
| `codediary.showChangePlan` | CodeDiary: Show Change Plan | — |

## Context Menu Contributions

- `editor/context` → Add Annotation, Mark as Reviewed, Mark as Critical
- `scm/resourceState/context` → Mark File as Reviewed

## Views

- `codediary-sidebar` (ViewContainer in activity bar)
  - `codediary.changePlan` — Change plan tree view
  - `codediary.criticalQueue` — Critical review queue
