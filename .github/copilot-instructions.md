# CodeLore Integration

When modifying files in this project, check for CodeLore annotations before making changes:

1. Look for `.codelore/` directory at the project root — it contains per-file YAML annotations committed by the team.
2. For a file like `src/auth/middleware.ts`, check `.codelore/src/auth/middleware.ts.yaml` for existing annotations.
3. Each annotation has: line range, category (behavior, rationale, constraint, gotcha, business_rule, performance, security, human_note), and text.
4. Annotations may include `dependencies` — cross-file links to related code. When modifying linked files, check the annotations that reference them.
5. Critical flags mark security-sensitive or high-risk regions — respect these and do not modify flagged code without explicit instruction.
6. If you add or change code in an annotated region, mention the existing annotation context in your response.
7. **Re-anchoring**: When you move, rename, or refactor code that has annotations, update the `line_start` and `line_end` fields in the corresponding `.codelore/` YAML file to match the new line positions. Also update `anchor.content_hash` if you change the content — the hash is a truncated SHA-256 of the trimmed non-empty lines joined by newlines. If the annotation has a `signature_hash`, update it based on the function/class signature line.
8. After making changes, suggest the developer add CodeLore annotations for the modified regions.

# End CodeLore Integration
