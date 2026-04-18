# CodeLore — Implementation Guide

Context infrastructure for AI-assisted development. A VSCode extension that builds a living knowledge layer — capturing what developers discover, decide, and verify as AI agents modify code at scale.

**Tagline:** "Know what changed and why."

## Why CodeLore Exists

AI agents write code fast. AI reviewers review it fast. Both are context-blind.

The agent that rewrites a payment module doesn't know the billing loop has an intentional off-by-one. The AI reviewer that flags it as a bug every PR doesn't know either. The senior engineer who understands it has explained it three times in Slack, twice in PR comments, and once in a meeting. Next quarter she's on a different team and that knowledge is gone.

CodeLore captures that knowledge, persists it alongside the code, and delivers it at the moment of relevance — to developers, to AI agents, and to AI review tools.

### The Gap It Fills

Existing tools address AI code generation (Cursor, Claude Code, Copilot) and AI code review (CodeRabbit, Copilot Review). Nothing addresses what happens between: **human knowledge capture during AI-driven development**. Developers learn things about the codebase as they work — what a module actually does, why a quirk exists, which regions are dangerous — and that knowledge dies in Slack threads, forgotten PR comments, or tribal memory.

### Why Not Inline Comments or Git History?

**Comments** pollute the source, have no structure, no lifecycle, no audit trail, and no way to be personal. You'll never write `// I don't understand this module` in shared source code. Comments don't warn you when you modify the code they describe.

**Git history** tells you what changed, not what you need to know. `git blame` gives you who and when, not why or what's dangerous. PR comments — where the real knowledge lives — are in a web UI, tied to stale diffs, unsearchable from the IDE, and invisible to AI agents.

CodeLore annotations are a **separate metadata layer** — visible when needed, invisible when not, queryable, structured for both human and AI consumption, and proactive (they find you, you don't have to find them).

### Core Value Propositions

1. **Context for AI agents.** Annotations in `.codelore/` give AI agents a map of what matters before they modify code — fewer hallucinations, fewer re-discoveries, fewer wasted tokens.
2. **Noise reduction for AI reviewers.** A `verified` annotation saying "off-by-one is intentional" stops your AI review tool from filing the same false positive every sprint.
3. **Proactive knowledge delivery.** Open a file with critical flags — you get warned. Save changes overlapping known risks — you get briefed. Knowledge finds you at the moment it matters.
4. **Knowledge capture at point of discovery.** Developers annotate code as they explore and modify it, building structured understanding incrementally across the team.
5. **Shared institutional memory.** Team annotations persist in git alongside the source tree. Survives turnover. Developer A annotates a module today; Developer B inherits that knowledge.
6. **AI-assisted, not AI-dependent.** AI drafts annotations from diffs so the developer curates rather than writes from scratch. Works fully without AI — manual annotation is first-class.

## Architecture Overview

```
codelore/
├── src/
│   ├── extension.ts              # Activation, command/view registration
│   ├── models/
│   │   ├── annotation.ts         # Annotation model + 9 categories + ContentAnchor + FileDependency
│   │   └── criticalFlag.ts       # Critical region flag + resolution model
│   ├── storage/
│   │   ├── loreStore.ts         # Facade: merges shared + personal stores
│   │   ├── sharedStore.ts        # Per-file YAML in .codelore/ (git-committed)
│   │   └── yamlStore.ts          # Single YAML in .vscode/ (personal, gitignored)
│   ├── providers/
│   │   ├── annotationDecorator.ts    # Inline text + colored backgrounds per category
│   │   ├── criticalDecorator.ts      # Red/green shield on critical regions
│   │   └── knowledgeNotifier.ts      # Proactive warnings on file open/save
│   ├── views/
│   │   ├── changePlanProvider.ts     # TreeView sidebar: annotations grouped by file
│   │   ├── criticalQueueProvider.ts  # TreeView: sorted critical review queue
│   │   └── coverageBar.ts           # Status bar: annotation + critical summary
│   ├── commands/
│   │   ├── annotate.ts           # Add/edit/delete annotations with scope picker
│   │   ├── markCritical.ts       # Flag critical regions, resolve/remove
│   │   ├── component.ts          # Manage component memberships for a file, edit components
│   │   ├── filter.ts             # Single chooser that dispatches to category/component/severity/path
│   │   ├── quickNote.ts          # One-tap human_note (no category picker) + copy annotations to clipboard
│   │   ├── agentInstructions.ts  # Generate CLAUDE.md/.cursorrules/etc. with knowledge
│   │   ├── reanchor.ts           # codelore.checkAnchors — verify + picker-driven re-anchor
│   │   └── search.ts             # Search annotations across codebase
│   ├── ai/
│   │   ├── lmService.ts          # vscode.lm API wrapper with model picker
│   │   ├── componentProposer.ts  # AI component partitioning from file paths
│   │   └── loreGenerator.ts      # Unified scan: one call per file → annotations + critical flags
│   └── utils/
│       ├── anchorEngine.ts       # Content + signature hashing, drift detection, re-anchor search
│       ├── git.ts                # Changed files, line range parsing
│       └── validation.ts         # Path safety, markdown sanitization, input validation
├── test/                         # Vitest unit tests (390+ tests, 98%+ coverage)
├── .codelore/                   # Shared annotation store (committed to git)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .vscode/
    └── launch.json
```

## Key Design Decisions

### Shared + Personal Storage (Dual-Store Architecture)

- **Shared store** (`.codelore/` directory, committed to git): Per-file YAML mirroring the source tree (e.g., `.codelore/src/auth/middleware.ts.yaml`). Merge-conflict-safe. Knowledge persists across team members and survives turnover.
- **Personal store** (`.vscode/codelore.yaml`, gitignored): Single flat YAML file for private notes. Allows candid annotations ("I don't understand this") that shouldn't be committed.
- **LoreStore facade** merges reads from both stores and routes writes based on a scope picker. Default scope configurable via `codelore.defaultScope` setting.
- **Personal annotations are excluded from AI context** — private notes never leak into suggestions visible to the team.

### Proactive Notifications

Knowledge shouldn't wait in a sidebar for someone to check it:

- **On file open:** If the file has unresolved critical flags, a warning appears immediately with a link to the Critical Review Queue.
- **On file save:** If uncommitted changes overlap known annotations, critical flags, or incoming cross-file dependencies, an informational nudge appears. "Your changes overlap 2 critical flags — review before committing."
- **Anti-spam:** Each file only triggers once per session (resets when store changes).
- **Pre-commit surface for AI reviewers:** The same annotations reach AI agents (Claude Code, Cursor, Copilot) via the generated instruction files, so pre-commit awareness of knowledge flows through whatever AI reviewer already reviews the diff.

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
- **Save notifications** warn when your edits touch files that other annotations depend on — e.g., change `billing/calc.py` and you'll see that `reporting/monthly.py` declared a dependency on it
- AI suggestions can automatically detect and propose cross-file links when code is tightly coupled
- Manual dependency linking is available during annotation creation via a prompted flow

### AI Integration via vscode.lm API

No custom LLM infrastructure. Uses `vscode.lm.selectChatModels()` to leverage whatever language model the user already has installed (GitHub Copilot, Claude, etc.).

- Model picker when multiple models available, remembers selection for session
- Three scan entry points — `Scan File` (active editor), `Scan Component` (all files tagged into a component), `Scan Project` (every source file in the workspace). Each entry point makes **one** model call per file that emits both knowledge annotations and critical-flag suggestions together. `Scan Project` on a component-less workspace first offers to propose components so new entries can be tagged into subsystems from the start.
- AI-authored entries land directly in the store with `source: ai_generated`; the human verifies later via the inline ✓ action.
- Existing annotations are injected into AI prompts to prevent duplicates.
- AI features are opt-in; the tool is fully functional with manual-only annotation.

### AI Agent Integration

Annotations in `.codelore/` are structured YAML — readable by any AI agent. The `generateAgentInstructions` command writes configuration for Claude Code, Cursor, Copilot, Windsurf, and generic agents, pointing them to the knowledge store.

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

Palette-visible commands the user types. Context-menu-only commands
(`editAnnotation`, `deleteAnnotation`, `editComponent`, `verifyAnnotation`,
`resolveCritical`, `removeCritical`, `refreshSidebar`) are hidden from the
palette via `menus.commandPalette` `when: false`.

| Command | Title | Keybinding |
|---------|-------|------------|
| `codelore.addAnnotation` | Add Annotation | `Cmd+Shift+L` |
| `codelore.markCritical` | Mark as Critical | — |
| `codelore.scanFile` | Scan Current File | `Cmd+Shift+K` |
| `codelore.scanComponent` | Scan Component | — |
| `codelore.scanProject` | Scan Project | — |
| `codelore.proposeComponent` | Propose Components (AI) | — |
| `codelore.manageComponentsForFile` | Manage Components for File | — |
| `codelore.quickNote` | Quick Note | `Cmd+Shift+J` |
| `codelore.copyAnnotationsForFile` | Copy Annotations for Current File | — |
| `codelore.generateAgentInstructions` | Generate Agent Instruction Files | — |
| `codelore.checkAnchors` | Check Annotation Anchors | — |
| `codelore.filter` | Filter | — |
| `codelore.searchAnnotations` | Search Annotations | — |
| `codelore.changeModel` | Change AI Model | — |

## Sidebar Views

| View | Description |
|------|-------------|
| **Components** | Components with their tagged files; click a file to open it |
| **Annotations** | All annotations grouped by file (collapsed by default), filterable by category and path |
| **Critical Review Queue** | All critical flags sorted by severity (unresolved first), filterable by severity and path |

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `codelore.storagePath` | string | `.vscode/codelore.yaml` | Personal storage file path |
| `codelore.defaultScope` | `shared` \| `personal` | `shared` | Where new annotations are stored by default |

## Annotation Categories

Categories describe properties of the code itself, not workflow state.
Verification status is tracked as a separate field (`source:
ai_generated | ai_verified | human_authored`), not a category.

| Category | Purpose |
|----------|---------|
| `behavior` | What the code does — especially non-obvious behavior |
| `rationale` | Why it was built this way — decisions, rejected alternatives |
| `constraint` | Invariant, precondition, or postcondition that must hold |
| `gotcha` | Footgun, counterintuitive quirk, known hazard |
| `business_rule` | Domain rule — do not change without stakeholder sign-off |
| `performance` | Hot path, complexity assumption, benchmark-sensitive region |
| `security` | Trust boundary, auth assumption, sanitization requirement |
| `human_note` | Free-form human commentary — observations, questions |

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
- Inline annotations across 8 knowledge categories, scope picker, content + signature anchoring
- `source: ai_generated | ai_verified | human_authored` tracked as a separate field from category; inline ✓ action promotes AI drafts to verified
- Critical flag lifecycle (flag with severity, resolve with comment, remove)
- Components: tag-first grouping with a single `manageComponentsForFile` multi-select picker
- Proactive notifications on file open (critical flags) and save (overlap detection)
- AI knowledge extraction + critical detection over full files via `scanFile`, `scanComponent`, and `scanProject`
- AI-proposed components (`proposeComponent`) seeded from current annotations
- AI feedback loop: existing annotations injected into prompts to prevent duplicates
- Components, Annotations, and Critical Review Queue sidebar views
- Status bar with coverage summary and active-file component membership
- Annotation search across codebase (text, category, file path filters with jump to source)
- Unified filter command (`codelore.filter`) that dispatches to category/component/severity/path dimensions
- Single anchor command (`codelore.checkAnchors`) that verifies all anchors and opens a re-anchor picker for drift
- Quick note command (`Cmd+Shift+J`) that skips the category picker and writes a `human_note` at the configured default scope
- Copy annotations for current file to clipboard
- Agent instruction file generation (CLAUDE.md, .cursorrules, copilot-instructions, AGENTS.md, .windsurfrules)
- Shared/personal dual-store architecture with privacy boundary (personal excluded from AI context)
- Cross-file dependency links: annotations can declare relationships to other files, surfaced in save notifications and consumable by AI reviewers via generated instruction files
- Security hardening: markdown sanitization, path traversal prevention, symlink-safe writes, scoped command trust
- Unit test suite (390+ tests, 98%+ line coverage)

### Deferred (build only if users pull for them)
- Knowledge coverage heatmap (churn vs annotation coverage)
- Annotation aging (detect outdated annotations where surrounding code evolved)
- Team annotation feed (summary of .codelore/ changes after git pull)
- Quick annotation from AI review comments (bridge between AI reviewer and persistent knowledge)
- Pre-commit/pre-push guard for unreviewed critical regions
- JIRA/Linear ticket linkage

# CodeLore Integration

When modifying files in this project, check for CodeLore annotations before making changes:

1. Look for `.codelore/` directory at the project root — it contains per-file YAML annotations committed by the team.
2. For a file like `src/auth/middleware.ts`, check `.codelore/src/auth/middleware.ts.yaml` for existing annotations.
3. Each annotation has: line range, category (`behavior`, `rationale`, `constraint`, `gotcha`, `business_rule`, `performance`, `security`, `human_note`), text, and `source` (`ai_generated | ai_verified | human_authored`). Treat `ai_verified` and `human_authored` entries as authoritative; `ai_generated` entries are drafts pending review.
4. Annotations may include `dependencies` — cross-file links to related code. When modifying linked files, check the annotations that reference them.
5. Critical flags mark security-sensitive or high-risk regions — respect these and do not modify flagged code without explicit instruction.
6. If you add or change code in an annotated region, mention the existing annotation context in your response.
7. **Re-anchoring**: When you move, rename, or refactor code that has annotations, update the `line_start` and `line_end` fields in the corresponding `.codelore/` YAML file to match the new line positions. Also update `anchor.content_hash` if you change the content — the hash is a truncated SHA-256 of the trimmed non-empty lines joined by newlines. If the annotation has a `signature_hash`, update it based on the function/class signature line.
8. After making changes, suggest the developer add CodeLore annotations for the modified regions.

# End CodeLore Integration
