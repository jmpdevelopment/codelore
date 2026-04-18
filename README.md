# CodeLore

**Institutional knowledge layer for AI-accelerated development.** A VSCode extension that captures what AI agents and humans learn about a codebase — decisions, constraints, gotchas, business rules — and makes that knowledge available at the moment of relevance.

> Know what changed and why.

## What it is

On large, mature codebases, the bottleneck isn't writing code — it's comprehension. AI agents modify modules last touched years ago. The knowledge a developer gains while working through unfamiliar code with AI assistance — what a module actually does, why a quirk exists, which regions are dangerous — dies in Slack threads or walks out the door.

CodeLore captures that knowledge as structured YAML alongside the source tree, surfaces it proactively when it matters (file open, file save, pre-commit), and feeds it back to AI agents and reviewers so they stop re-litigating the same things.

Unlike inline comments, CodeLore annotations are a separate metadata layer — queryable, lifecycle-aware, and split into shared (committed to git) and personal (gitignored) scopes so candid notes don't leak.

## Install

1. Clone and build:
   ```bash
   git clone <repo>
   cd codelore
   npm install
   npm run build
   ```
2. Press `F5` in VSCode to launch the Extension Development Host.
3. For a packaged `.vsix`, run `npx vsce package` and install via *Extensions → Install from VSIX*.

## First 60 seconds

1. Open a file you want to understand.
2. Press **`Cmd+Shift+K`** to let CodeLore scan the file for institutional knowledge. The AI drafts annotations with `source: ai_generated`.
3. Skim the drafts in the **Annotations** sidebar. For each one that's right, click the ✓ to verify it (stamps `ai_verified` + your handle).
4. Add your own annotation on a line you understand better than the AI: select the range and press **`Cmd+Shift+L`**.
5. Press **`Cmd+Shift+B`** to open the **Pre-Commit Brief** — it cross-references the annotations you have against the diff in your working tree. This is your primary consumption surface.

## The 8 knowledge categories

Annotations describe properties of the code, not workflow state:

| Category | Purpose |
|---|---|
| `behavior` | What the code does — especially non-obvious behavior |
| `rationale` | Why it was built this way — decisions, rejected alternatives |
| `constraint` | Invariant, precondition, or postcondition that must hold |
| `gotcha` | Footgun, counterintuitive quirk, known hazard |
| `business_rule` | Domain rule — do not change without stakeholder sign-off |
| `performance` | Hot path, complexity assumption, benchmark-sensitive region |
| `security` | Trust boundary, auth assumption, sanitization requirement |
| `human_note` | Free-form human commentary — observations, questions |

Plus `ai_prompt` — ephemeral personal scratchpad for talking to the AI, never exported.

## Components

Files don't live alone. Components group related files into logical subsystems (a module, a feature area, a service boundary). Use `Manage Components for File` to multi-select which components the current file belongs to in one picker, or ask the AI to propose components via `Propose Components (AI)`.

- Component definitions live at `.codelore/components/<slug>.yaml` with `name`, `description`, `owners`, `files`.
- The **Components** sidebar view groups files by component; clicking a file opens it.
- The status bar shows which component(s) your active editor belongs to.

## AI workflow

CodeLore is bidirectional: AI agents *read* annotations before modifying code and *author* new annotations when they learn something.

- **Reading:** `Generate Agent Instruction Files` writes a CodeLore block into `CLAUDE.md`, `.cursorrules`, `AGENTS.md`, `.github/copilot-instructions.md`, or `.windsurfrules`. The block tells the agent where knowledge lives, how to read it, and how to maintain content/signature anchors on refactor.
- **Authoring:** The agent writes annotations directly into `.codelore/<path>.yaml` with `source: ai_generated`. Humans promote them to `ai_verified` with the inline ✓ action.
- **Verification status is a field, not a category.** Every annotation has `source: ai_generated | ai_verified | human_authored`. The `ai_generated` ones are drafts; the Pre-Commit Brief flags them as unverified so reviewers can sweep them.
- No custom LLM — uses `vscode.lm` so it runs on whatever model you already have (GitHub Copilot, Claude, etc.).

## Keyboard shortcuts

CodeLore caps itself at 4 chords. Everything else is in the command palette.

| Shortcut | Action |
|---|---|
| `Cmd+Shift+L` | Add annotation on selection |
| `Cmd+Shift+K` | Scan current file for knowledge + critical regions (AI) |
| `Cmd+Shift+J` | Quick AI note (ephemeral, personal) |
| `Cmd+Shift+B` | Open Pre-Commit Brief |

On Windows/Linux, swap `Cmd` for `Ctrl`.

## Storage model

CodeLore has two stores:

- **Shared** (`.codelore/`, committed to git): per-file YAML mirroring the source tree — `.codelore/src/auth/middleware.ts.yaml` holds annotations for `src/auth/middleware.ts`. Merge-conflict-safe. Survives turnover.
- **Personal** (`.vscode/codelore.yaml`, gitignored): a single flat YAML for private notes ("I don't understand this") you don't want committed. Also holds any `ai_prompt` entries.

Personal annotations never leak into AI context or team-facing views. `Clear Personal Data` wipes only the personal store.

### Anchoring

Annotations are tied to code by two hashes, so they track the code across refactors:

- **Content hash** — SHA-256 of the trimmed non-empty lines; whitespace-immune. A sliding-window search finds the region when it moves.
- **Signature hash** — SHA-256 of the function/class signature line. Used as a fallback when the body changed but the declaration didn't. Supports Python and TypeScript/JavaScript.

On file open, stale anchors get a ⚠ warning. `Check Annotation Anchors` scans the active file and opens a picker of suggested re-anchor positions — the developer confirms, no silent drift.

## Proactive surfaces

Knowledge finds you; you don't have to find it.

- **Pre-Commit Brief** — cross-references `git diff HEAD` against annotations, critical flags, and cross-file dependencies. Files sorted by risk (unresolved critical first). Unverified AI annotations are badged.
- **On file open** — unresolved critical flags pop a warning.
- **On file save** — if your edits overlap known annotations or flags, a nudge appears: "Your changes overlap 2 critical flags — review before committing."
- **Status bar** — annotation count and unreviewed-critical count at a glance. Click to open the brief.

## FAQ

**Do I need an AI model configured?** No. CodeLore is fully functional with manual annotation. AI features use `vscode.lm` and are opt-in.

**Can AI agents write annotations on their own?** Yes — that's the intended model. The agent instruction block tells them to append to `.codelore/<path>.yaml` with `source: ai_generated`. Humans verify in review.

**Are personal notes ever shared with AI?** No. The shared/personal boundary is enforced — personal annotations are excluded from AI prompts and team-facing views.

**Does CodeLore replace PR review?** No. It captures the knowledge that review tools and comments don't preserve — the kind that usually lives in a senior engineer's head. Use it alongside your existing review process.

## Development

```bash
npm run compile        # TypeScript compilation
npm run build          # esbuild bundle
npm run test           # Vitest unit tests
npm run test:coverage  # Tests with coverage report
npm run lint           # Type check without emit
```

## License

MIT
