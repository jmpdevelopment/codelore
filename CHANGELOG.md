# Changelog

All notable changes to the CodeLore extension are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://marketplace.visualstudio.com/items?itemName=jmpdevelopment.codelore
