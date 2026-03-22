# CodeDiary — Implementation Guide

Context infrastructure for AI-assisted development. A VSCode extension that builds a living knowledge layer — capturing what developers discover, decide, and verify as AI agents modify code at scale.

**Tagline:** "Know what changed and why."

## Why CodeDiary Exists

AI agents write code fast. AI reviewers review it fast. Both are context-blind.

The agent that rewrites a payment module doesn't know the billing loop has an intentional off-by-one. The AI reviewer that flags it as a bug every PR doesn't know either. The senior engineer who understands it has explained it three times in Slack, twice in PR comments, and once in a meeting. Next quarter she's on a different team and that knowledge is gone.

CodeDiary captures that knowledge, persists it alongside the code, and delivers it at the moment of relevance — to developers, to AI agents, and to AI review tools.

### The Gap It Fills

Existing tools address AI code generation (Cursor, Claude Code, Copilot) and AI code review (CodeRabbit, Copilot Review). Nothing addresses what happens between: **human knowledge capture during AI-driven development**. Developers learn things about the codebase as they work — what a module actually does, why a quirk exists, which regions are dangerous — and that knowledge dies in Slack threads, forgotten PR comments, or tribal memory.

### Why Not Inline Comments or Git History?

**Comments** pollute the source, have no structure, no lifecycle, no audit trail, and no way to be personal. You'll never write `// I don't understand this module` in shared source code. Comments don't warn you when you modify the code they describe.

**Git history** tells you what changed, not what you need to know. `git blame` gives you who and when, not why or what's dangerous. PR comments — where the real knowledge lives — are in a web UI, tied to stale diffs, unsearchable from the IDE, and invisible to AI agents.

CodeDiary annotations are a **separate metadata layer** — visible when needed, invisible when not, queryable, structured for both human and AI consumption, and proactive (they find you, you don't have to find them).

### Core Value Propositions

1. **Context for AI agents.** Annotations in `.codediary/` give AI agents a map of what matters before they modify code — fewer hallucinations, fewer re-discoveries, fewer wasted tokens.
2. **Noise reduction for AI reviewers.** A `verified` annotation saying "off-by-one is intentional" stops your AI review tool from filing the same false positive every sprint.
3. **Proactive knowledge delivery.** Open a file with critical flags — you get warned. Save changes overlapping known risks — you get briefed. Knowledge finds you at the moment it matters.
4. **Knowledge capture at point of discovery.** Developers annotate code as they explore and modify it, building structured understanding incrementally across the team.
5. **Shared institutional memory.** Team annotations persist in git alongside the source tree. Survives turnover. Developer A annotates a module today; Developer B inherits that knowledge.
6. **AI-assisted, not AI-dependent.** AI drafts annotations from diffs so the developer curates rather than writes from scratch. Works fully without AI — manual annotation is first-class.

## Architecture Overview

```
codediary/
├── src/
│   ├── extension.ts              # Activation, command/view registration
│   ├── models/
│   │   ├── annotation.ts         # Annotation model + 9 categories + ContentAnchor + FileDependency
│   │   ├── reviewMarker.ts       # Human review marker model
│   │   └── criticalFlag.ts       # Critical region flag + resolution model
│   ├── storage/
│   │   ├── diaryStore.ts         # Facade: merges shared + personal stores
│   │   ├── sharedStore.ts        # Per-file YAML in .codediary/ (git-committed)
│   │   └── yamlStore.ts          # Single YAML in .vscode/ (personal, gitignored)
│   ├── providers/
│   │   ├── annotationDecorator.ts    # Inline text + colored backgrounds per category
│   │   ├── reviewMarkerDecorator.ts  # Green checkmark on reviewed lines
│   │   ├── criticalDecorator.ts      # Red/green shield on critical regions
│   │   └── knowledgeNotifier.ts      # Proactive warnings on file open/save
│   ├── views/
│   │   ├── changePlanProvider.ts     # TreeView sidebar: annotations grouped by file
│   │   ├── criticalQueueProvider.ts  # TreeView: sorted critical review queue
│   │   ├── preCommitBriefProvider.ts # TreeView: diff-aware knowledge briefing
│   │   └── coverageBar.ts           # Status bar: annotation + review summary
│   ├── commands/
│   │   ├── annotate.ts           # Add/edit/delete annotations with scope picker
│   │   ├── markReviewed.ts       # Mark lines/files as human-reviewed
│   │   ├── markCritical.ts       # Flag critical regions, resolve/remove
│   │   ├── clearAll.ts           # Set narrative, clear personal data
│   │   ├── quickNote.ts          # Ephemeral AI notes + copy annotations to clipboard
│   │   ├── agentInstructions.ts  # Generate CLAUDE.md/.cursorrules/etc. with knowledge
│   │   ├── reanchor.ts           # Re-anchor stale annotations after code moves
│   │   └── search.ts             # Search annotations across codebase
│   ├── ai/
│   │   ├── lmService.ts          # vscode.lm API wrapper with model picker
│   │   ├── diaryGenerator.ts     # AI-suggested diary entries from diffs
│   │   └── criticalDetector.ts   # AI critical logic detection (diff + full file)
│   └── utils/
│       ├── anchorEngine.ts       # Content + signature hashing, drift detection, re-anchor search
│       ├── git.ts                # Git diff, changed files, line range parsing
│       └── validation.ts         # Path safety, markdown sanitization, input validation
├── test/                         # Vitest unit tests (300 tests, 98%+ coverage)
├── .codediary/                   # Shared annotation store (committed to git)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .vscode/
    └── launch.json
```

## Key Design Decisions

### Shared + Personal Storage (Dual-Store Architecture)

- **Shared store** (`.codediary/` directory, committed to git): Per-file YAML mirroring the source tree (e.g., `.codediary/src/auth/middleware.ts.yaml`). Merge-conflict-safe. Knowledge persists across team members and survives turnover.
- **Personal store** (`.vscode/codediary.yaml`, gitignored): Single flat YAML file for private notes. Allows candid annotations ("I don't understand this") that shouldn't be committed.
- **DiaryStore facade** merges reads from both stores and routes writes based on a scope picker. Default scope configurable via `codediary.defaultScope` setting.
- **Narrative** is personal-only (your intent description for a work session).
- **clearAll** only clears the personal store to protect team knowledge.
- **Personal annotations are excluded from AI context** — private notes never leak into suggestions visible to the team.

### Pre-Commit Brief (Diff-Centric Knowledge Delivery)

The Pre-Commit Brief is the primary consumption surface. Instead of requiring developers to browse annotations, it answers: "What do I need to know about the code I'm about to commit?"

- Reads `git diff HEAD` to identify changed files and line ranges
- Cross-references changes with existing annotations and critical flags
- Items overlapping changed lines are highlighted (⚡)
- Cross-file dependencies from other annotations are surfaced as linked items
- Files sorted by risk: unresolved critical flags first, then dependency count
- Refreshes automatically on store changes and editor focus

### Proactive Notifications

Knowledge shouldn't wait in a sidebar for someone to check it:

- **On file open:** If the file has unresolved critical flags, a warning appears immediately with a link to the brief.
- **On file save:** If uncommitted changes overlap known annotations, critical flags, or cross-file dependencies, a nudge appears. "Your changes overlap 2 critical flags — review before committing."
- **Anti-spam:** Each file only triggers once per session (resets when store changes).

### Content Anchoring

Annotations are tied to code via two complementary strategies:

1. **Content hash** (primary): SHA-256 of trimmed, non-empty lines in the annotated region. Whitespace-immune. Sliding window search finds where code moved.
2. **Signature hash** (fallback): SHA-256 of the function/class/method signature line. When the body changes but the declaration is intact, the annotation can still be located. Supports Python (`def`, `class`, `async def`) and TypeScript/JavaScript (`function`, `class`, arrow functions, methods). Reported as `confidence: 'low'` to distinguish from exact content matches.

When code moves or changes:

- Anchors are verified on file open — stale annotations show a ⚠ warning
- Content hash match tried first (exact or shifted position)
- Signature hash used as fallback when content changed but signature intact
- Developer confirms re-anchor suggestions — no silent position changes
- Agent instruction files tell AI agents to maintain anchors when refactoring

Whitespace changes (reformatting, prettier) don't break anchors. Tradeoff: two code blocks differing only by whitespace hash the same. Acceptable.

### Cross-File Dependencies

Annotations can declare dependencies on other files via `FileDependency` entries:

- Each dependency links to a target file (with optional line range) and describes the relationship (e.g., "must stay in sync", "calls this function", "shares this data model")
- **Pre-Commit Brief** surfaces incoming dependencies: if you change `billing/calc.py` and an annotation on `reporting/monthly.py` declares a dependency on it, you see that link before committing
- **Save notifications** warn when your edits touch files that other annotations depend on
- Dependencies are sorted above regular annotations in the brief (after critical flags)
- AI suggestions can automatically detect and propose cross-file links when code is tightly coupled
- Manual dependency linking is available during annotation creation via a prompted flow

### AI Integration via vscode.lm API

No custom LLM infrastructure. Uses `vscode.lm.selectChatModels()` to leverage whatever language model the user already has installed (GitHub Copilot, Claude, etc.).

- Model picker when multiple models available, remembers selection for session
- Two scan modes: **diff-based** (changed code only) and **full-file** (exploring unfamiliar code)
- AI suggestions presented as multi-select quick pick — developer curates, not writes from scratch
- Existing annotations injected into AI prompts to prevent duplicates
- AI features are opt-in; the tool is fully functional with manual-only annotation

### AI Agent Integration

Annotations in `.codediary/` are structured YAML — readable by any AI agent. The `generateAgentInstructions` command writes configuration for Claude Code, Cursor, Copilot, Windsurf, and generic agents, pointing them to the knowledge store.

AI agents consume annotations as context (what to preserve, what's dangerous, what's intentional). AI agents can also produce annotations by writing to the YAML files directly.

### No Static Pattern Detection

Critical logic detection is either:
1. **AI-native** — LLM semantic analysis of code (opt-in)
2. **Manual** — developer flags regions by hand

No AST parsing, no regex rules, no static patterns. Semantic understanding of "what matters" requires either human judgment or AI reasoning, not pattern matching.

### Security Hardening

- **Markdown sanitization**: All user-supplied text in hover messages is stripped of link syntax to prevent command injection via `command:` URIs
- **Path traversal prevention**: `isSafeRelativePath()` rejects absolute paths and `..` traversal before any file open operation
- **Symlink safety**: Both stores resolve symlinks before writing to prevent writes outside the workspace
- **Scoped trust**: Hover messages use `enabledCommands` whitelist instead of blanket `isTrusted: true`

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
| `codediary.quickNote` | Quick AI Note (Ephemeral) | `Cmd+Shift+L` |
| `codediary.copyAnnotationsForFile` | Copy Annotations for Current File | — |
| `codediary.generateAgentInstructions` | Generate Agent Instruction Files | — |
| `codediary.reanchor` | Re-anchor Stale Annotations | — |
| `codediary.verifyAnchors` | Verify Annotation Anchors | — |
| `codediary.setNarrative` | Set Change Narrative | — |
| `codediary.clearAll` | Clear Personal Data | — |
| `codediary.searchAnnotations` | Search Annotations | — |
| `codediary.filterByCategory` | Filter by Category | — |
| `codediary.filterByPath` | Filter by File/Folder Path | — |
| `codediary.filterBySeverity` | Filter Critical by Severity | — |
| `codediary.clearFilters` | Clear All Filters | — |
| `codediary.refreshSidebar` | Refresh | — |
| `codediary.suggestDiary` | Suggest Diary Entries (Current File) | — |
| `codediary.suggestDiaryAll` | Suggest Diary Entries (All Changes) | — |
| `codediary.scanCritical` | Scan Changes for Critical Logic (Diff Only) | — |
| `codediary.scanCriticalAll` | Scan All Uncommitted Changes (Diff Only) | — |
| `codediary.scanFile` | Scan Entire File for Critical Logic (Full File) | — |
| `codediary.changeModel` | Change AI Model | — |

## Sidebar Views

| View | Description |
|------|-------------|
| **Pre-Commit Brief** | Diff-aware knowledge briefing — shows changed files with overlapping annotations, critical flags, and cross-file dependencies, sorted by risk |
| **Annotations** | All annotations grouped by file, filterable by category and path |
| **Critical Review Queue** | All critical flags sorted by severity (unresolved first), filterable by severity and path |

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `codediary.storagePath` | string | `.vscode/codediary.yaml` | Personal storage file path |
| `codediary.defaultScope` | `shared` \| `personal` | `shared` | Where new annotations are stored by default |

## Annotation Categories

| Category | Icon | Purpose |
|----------|------|---------|
| Verified | ✓ | Reviewed this change, it's correct |
| Needs Review | 🔍 | Haven't fully verified — reviewer should check |
| Modified | ✏️ | Changed the AI's output manually |
| Don't Understand | ? | Don't understand why the AI did this |
| Potential Hallucination | ⚠ | May reference non-existent APIs or patterns |
| Intent Note | 💬 | Context about what was asked of the AI |
| Accepted As-Is | 👍 | Reviewed, acceptable without changes |
| Business Rule | ⚖ | Documents a business rule or domain constraint — don't change without stakeholder sign-off |
| AI Prompt | 🤖 | Ephemeral note for AI agent — excluded from team features |

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

### Complete
- Inline annotations with 9 categories, scope picker, and content + signature anchoring
- Human review markers with merge logic for overlapping ranges
- Critical flag lifecycle (flag with severity, resolve with comment, remove)
- Pre-Commit Brief: diff-aware knowledge surfacing sorted by risk
- Proactive notifications on file open (critical flags) and save (overlap detection)
- AI-suggested diary entries from git diffs (via vscode.lm)
- AI critical logic detection: diff-based and full-file scanning
- AI knowledge feedback loop: existing annotations injected into AI suggestion prompts
- Annotations sidebar with file grouping, category and path filtering
- Critical Review Queue sorted by severity with severity and path filtering
- Status bar with coverage summary
- Annotation search across codebase (text, category, file path filters with jump to source)
- Overlap detection: prevents annotation accumulation, auto-replaces AI-generated duplicates
- Content anchoring: drift detection via content hash + signature hash fallback, stale warnings, re-anchor suggestions
- Ephemeral AI notes (ai_prompt category, personal scope, excluded from team features)
- Copy annotations for current file to clipboard
- Agent instruction file generation (CLAUDE.md, .cursorrules, copilot-instructions, AGENTS.md, .windsurfrules)
- Shared/personal dual-store architecture with privacy boundary (personal excluded from AI context)
- Cross-file dependency links: annotations can declare relationships to other files, surfaced in pre-commit brief and save notifications
- Security hardening: markdown sanitization, path traversal prevention, symlink-safe writes, scoped command trust
- Unit test suite (300 tests, 98%+ line coverage)

### Deferred (build only if users pull for them)
- Knowledge coverage heatmap (churn vs annotation coverage)
- Annotation aging (detect outdated annotations where surrounding code evolved)
- Team annotation feed (summary of .codediary/ changes after git pull)
- Quick annotation from AI review comments (bridge between AI reviewer and persistent knowledge)
- Pre-commit/pre-push guard for unreviewed critical regions
- JIRA/Linear ticket linkage

# CodeDiary Integration

When modifying files in this project, check for CodeDiary annotations before making changes:

1. Look for `.codediary/` directory at the project root — it contains per-file YAML annotations committed by the team.
2. For a file like `src/auth/middleware.ts`, check `.codediary/src/auth/middleware.ts.yaml` for existing annotations.
3. Each annotation has: line range, category (verified, needs_review, modified, confused, hallucination, intent, accepted, business_rule, ai_prompt), and text.
4. Annotations may include `dependencies` — cross-file links to related code. When modifying linked files, check the annotations that reference them.
5. Critical flags mark security-sensitive or high-risk regions — respect these and do not modify flagged code without explicit instruction.
6. If you add or change code in an annotated region, mention the existing annotation context in your response.
7. **Re-anchoring**: When you move, rename, or refactor code that has annotations, update the `line_start` and `line_end` fields in the corresponding `.codediary/` YAML file to match the new line positions. Also update `anchor.content_hash` if you change the content — the hash is a truncated SHA-256 of the trimmed non-empty lines joined by newlines. If the annotation has a `signature_hash`, update it based on the function/class signature line.
8. After making changes, suggest the developer add CodeDiary annotations for the modified regions.

# End CodeDiary Integration
