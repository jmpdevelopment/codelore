# CodeDiary Roadmap

This file captures what is likely to land after the 0.1.0 public
release. Items move out of "considering" only when there's either user
pull from the field or a concrete partner integration — the project has
deliberately resisted building features on speculation.

## Shipping in 0.1.0

See [CHANGELOG.md](CHANGELOG.md) for the full release notes. The short
version: structured YAML knowledge store, 8 knowledge categories +
`ai_prompt`, components, critical flags, pre-commit brief, proactive
file-open/save notifications, three AI scan entry points
(file/component/project), content + signature anchoring, and agent
instruction file generation.

## Considering for the next release

- **Annotation aging.** Detect entries where the surrounding code has
  evolved enough that the knowledge itself is probably stale, not just
  the anchor. Heuristic would combine anchor-drift frequency with time
  since last verification.
- **Team annotation feed.** After a `git pull`, summarize what landed in
  `.codediary/` — new annotations, resolved criticals, freshly flagged
  regions — so reviewers can catch up without diffing YAML.
- **Quick annotation from AI review comments.** One-click capture of a
  CodeRabbit / Copilot Review comment into a `verified` or
  `business_rule` annotation, so the same false positive doesn't come
  back next sprint.
- **Pre-commit / pre-push guard.** Optional git hook that blocks commits
  overlapping unresolved critical regions unless the committer
  acknowledges the flag.
- **Ticket linkage.** Attach annotations to Jira / Linear ticket ids so
  the knowledge layer can be traced back to the decision that prompted
  it.
- **Knowledge coverage heatmap.** Overlay annotation density against
  git churn to surface hot, un-annotated regions.

## Explicitly out of scope

- **Static pattern detection.** Regex and AST heuristics for "critical
  logic" produce noise. Critical-region detection is either human
  judgment or AI reasoning, never pattern matching.
- **Custom LLM infrastructure.** CodeDiary will continue to ride on
  `vscode.lm` and whatever model the user has installed.
- **Replacing PR review.** The tool complements review by capturing the
  knowledge that comments don't preserve; it doesn't replace the review
  process itself.

## How priorities move

If you want any of the "considering" items sooner, file a GitHub issue
describing the scenario where it would have saved you. Pull from real
workflows is what gets features built.
