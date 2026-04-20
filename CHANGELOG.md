# Changelog

All notable changes to the CodeLore extension are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] — 2026-04-20

Agent-authored annotations were silently dropped. This release fixes the root cause and tells agents how to write correct files.

### Fixed

- **Component and annotation files with bare ISO timestamps load correctly.**
  js-yaml was auto-converting `created_at: 2026-04-20T00:00:00Z` into a
  `Date` object, which the schema validator rejected (`typeof !== 'string'`).
  All YAML loads now use `JSON_SCHEMA`, which keeps ISO-8601 strings as
  strings. Agent-authored files that looked correct but didn't appear in
  the sidebar will now load.
- **Silent rejection of invalid component files is gone.** When
  `normalizeComponent` drops a file for missing required fields, the
  extension now surfaces a warning instead of failing quietly.
- **`Refresh` command actually rescans disk.** The palette's
  `codelore.refreshSidebar` now forces all three stores to reload
  from disk before refreshing tree views, so files created while the
  extension is running appear without a window reload.
- **FileSystemWatcher cold-start.** Watchers are now rooted at the
  workspace folder rather than `.codelore/`, so they fire for files
  created before the `.codelore/` directory exists.

### Changed

- **Agent instruction template documents the v2 on-disk schema.** The
  generated CLAUDE.md / .cursorrules / AGENTS.md etc. now include the
  `version: 2` requirement, complete YAML envelopes for annotation and
  component files, and the path-mirror rule — so AI agents writing
  `.codelore/` files directly produce loadable output.

## [0.2.2] — 2026-04-19

### Changed

- **Updated extension icon.**

## [0.2.1] — 2026-04-19

Marketplace discoverability pass.

### Added

- **Demo GIF** at the top of the README so the Marketplace listing
  shows the extension in action above the fold.

### Changed

- **Marketplace category** moved from `Other` to `AI` so the extension
  surfaces alongside other agent tooling.
- **Marketplace short description** rewritten to name Claude Code,
  Cursor, and Copilot explicitly — the three AI agents this extension
  is designed to feed context to.
- **Keywords** retargeted around AI agent terms (`claude code`,
  `cursor`, `copilot`, `agents`, `agents.md`, `context`) to match how
  users search the Marketplace for this kind of tool.

## [0.2.0] — 2026-04-18

Onboarding, diagnostics, and a unified scan pipeline. Follow-up to the
0.1.0 launch focused on making the first-run experience discoverable
and the AI scan path cheaper and debuggable.

### Added

- **Sidebar welcome views.** Components and Annotations now show inline
  buttons on an empty repo — Propose Components, Scan Project, Add
  Annotation, Scan Current File, and a pointer to Generate Agent
  Instruction Files — so new users discover the bootstrap flow without
  reading docs.
- **Title-bar actions for setup and maintenance.** Generate Agent
  Instruction Files is surfaced on the Components and Annotations
  views; Check Annotation Anchors is surfaced on Annotations.
- **Scan diagnostics.** A "CodeLore" output channel logs every LLM
  prompt and response. Propose Components failures now report a
  specific reason (invalid JSON, empty array, no matching paths) with a
  "Show Details" action on the notification.
- **Component bootstrap on first scan.** `Scan Project` on a
  component-less workspace offers to propose components first so
  AI-generated annotations land tagged into subsystems.
- **Component Proposer fallback.** When a repo has no recent git
  changes and no existing annotations, the proposer now seeds from
  workspace source files (capped at 200).

### Changed

- **Unified scan pipeline.** `Scan File`, `Scan Component`, and `Scan
  Project` now make a single LLM call per file that emits knowledge
  annotations and critical flags together. Halves token and latency
  cost versus the previous two-pass approach.
- **Propose Components path matching** normalizes leading `./` and
  case so the common hallucination of
  `./src/Billing/Calc.ts` vs. `src/billing/calc.ts` now matches
  instead of silently dropping the proposal.
- **Annotations view** no longer collapses by default — annotations
  are the primary unit and shouldn't require a click to see.
- **Quick Note** (`Cmd+Shift+J`) writes a plain `human_note` honoring
  the configured default scope. Retitled from "Quick AI Note" and
  given a neutral icon so the label matches the behavior.
- **Status bar wording** switched from "N notes" to "N annotation(s)"
  so the count is category-agnostic.
- **Scan command labels** dropped the "(Knowledge + Critical)" suffix
  now that the single merged call makes it redundant.
- **Editor right-click submenu** slimmed: Resolve/Remove Critical and
  Copy Annotations removed (unguarded; available elsewhere with the
  right context), and Quick Note reordered to sit directly after Add
  Annotation.

### Removed

- **Pre-Commit Brief sidebar.** Save-time overlap notifications plus
  the generated agent instruction files already cover the same signal
  for both humans and AI reviewers.
- **`ai_prompt` category and Clear Personal Data command.** The
  ephemeral prompt category is gone; `KNOWLEDGE_CATEGORIES` collapsed
  into `ANNOTATION_CATEGORIES` (eight categories remain).
- **CriticalDetector.** Folded into LoreGenerator as part of the
  unified scan.
- **Refresh button on sidebar title bars.** Every storage source
  already runs a FileSystemWatcher; the views can't go stale. The
  command stays registered in the palette as an escape hatch.

### Fixed

- **Component status bar pill** click was wired to a renamed command
  and failed silently — now opens the component picker as intended.
- **Propose Components silent failures** on fresh repos now surface a
  specific reason instead of a generic "No proposals surfaced".

## [0.1.0] — 2026-04-18

Initial public release. CodeLore is a VSCode extension that captures
institutional knowledge alongside the source tree so it survives
AI-driven refactors, team turnover, and noisy AI reviewers.

### Added

- **Knowledge-store model.** Annotations are stored as structured YAML in
  `.codelore/` (team, committed to git) and `.vscode/codelore.yaml`
  (personal, gitignored). AI agents can both read and author entries.
- **Components.** Group files into named components with descriptions and
  owners. Tag-first flow: the `Manage Components for File` command
  multi-selects memberships in a single picker.
- **Eight knowledge categories:** behavior, rationale, constraint,
  gotcha, business rule, performance, security, and human note.
  Verification status (`ai_generated`, `ai_verified`, `human_authored`)
  is tracked as a separate field so AI drafts can be promoted to
  verified without changing the category.
- **Critical regions.** Mark, resolve, and remove critical flags on
  high-risk code with severity and human-reviewed lifecycle.
- **Content + signature anchoring.** Annotations survive whitespace
  changes, reformatting, and light refactors via SHA-256 hashing. Stale
  anchors are surfaced with a re-anchor picker.
- **AI integration via `vscode.lm`.** Three scan commands (`Scan File`,
  `Scan Component`, `Scan Project`) drive both knowledge extraction and
  critical-region detection through whatever model the user has
  installed (Copilot, Claude, etc.). Existing annotations are fed back
  into prompts to prevent duplicates.
- **Agent instruction file generation.** Writes CLAUDE.md, .cursorrules,
  copilot-instructions, AGENTS.md, and .windsurfrules that point AI
  agents at the knowledge store.
- **Proactive notifications.** Warns on file open when critical flags
  exist, and on save when uncommitted changes overlap known annotations
  or cross-file dependencies.
- **Cross-file dependencies.** Annotations can declare links to other
  files; save notifications and AI agents (via the generated
  instruction files) surface them at the right moment.
- **Security hardening.** Markdown sanitization, path traversal
  prevention, symlink-safe writes, scoped command trust in hovers.

[0.2.0]: https://marketplace.visualstudio.com/items?itemName=jmpdevelopment.codelore
[0.1.0]: https://marketplace.visualstudio.com/items?itemName=jmpdevelopment.codelore
