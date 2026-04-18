import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  AnnotationCategory,
  LEGACY_CATEGORIES,
  LEGACY_TO_KNOWLEDGE,
  normalizeSource,
} from '../models/annotation';
import { SCHEMA_VERSION } from './schema';

/**
 * v1 → v2 migration. Rewrites legacy review-workflow categories into their
 * knowledge-first equivalents (see {@link LEGACY_TO_KNOWLEDGE}), upgrades
 * legacy source enum values via {@link normalizeSource}, and stamps the
 * current {@link SCHEMA_VERSION}.
 *
 * Pure logic lives here so tests can drive the migration against real
 * temp directories without spinning up the full extension host.
 */

export interface MigrationReport {
  filesScanned: number;
  filesWritten: number;
  annotationsRemapped: number;
  sourcesNormalized: number;
}

const LEGACY_CATEGORY_SET: ReadonlySet<string> = new Set(LEGACY_CATEGORIES);

/** Map one legacy category to its knowledge-first target, or return it unchanged. */
function remapCategory(raw: unknown): { category: AnnotationCategory | undefined; changed: boolean } {
  if (typeof raw !== 'string') { return { category: undefined, changed: false }; }
  if (LEGACY_CATEGORY_SET.has(raw)) {
    const mapped = LEGACY_TO_KNOWLEDGE[raw as (typeof LEGACY_CATEGORIES)[number]];
    return { category: mapped, changed: true };
  }
  return { category: raw as AnnotationCategory, changed: false };
}

/**
 * Migrates a single parsed YAML document in place. Returns a report of how
 * many fields were rewritten; caller decides whether to re-serialize.
 */
export function migrateDocument(
  doc: Record<string, unknown>,
): { annotationsRemapped: number; sourcesNormalized: number; changed: boolean } {
  let annotationsRemapped = 0;
  let sourcesNormalized = 0;
  let changed = false;

  // Bump version if missing or old
  const currentVersion = typeof doc.version === 'number' ? doc.version : 1;
  if (currentVersion !== SCHEMA_VERSION) {
    doc.version = SCHEMA_VERSION;
    changed = true;
  }

  const annotations = doc.annotations;
  if (Array.isArray(annotations)) {
    for (const a of annotations) {
      if (!a || typeof a !== 'object') { continue; }
      const entry = a as Record<string, unknown>;

      // Category remap
      const { category, changed: catChanged } = remapCategory(entry.category);
      if (catChanged && category) {
        entry.category = category;
        annotationsRemapped++;
        changed = true;
      }

      // Source normalization — only counts as a change if the raw value differed
      const normalized = normalizeSource(entry.source);
      if (entry.source !== normalized) {
        entry.source = normalized;
        sourcesNormalized++;
        changed = true;
      }
    }
  }

  return { annotationsRemapped, sourcesNormalized, changed };
}

/**
 * Reads a YAML file, runs {@link migrateDocument}, and rewrites only if the
 * document actually changed. Returns per-file stats to aggregate into a report.
 * Idempotent: a clean v2 file is a no-op on subsequent runs.
 */
export function migrateYamlFile(filePath: string): {
  migrated: boolean;
  annotationsRemapped: number;
  sourcesNormalized: number;
} {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== 'object') {
    return { migrated: false, annotationsRemapped: 0, sourcesNormalized: 0 };
  }
  const doc = parsed as Record<string, unknown>;
  const { annotationsRemapped, sourcesNormalized, changed } = migrateDocument(doc);
  if (!changed) {
    return { migrated: false, annotationsRemapped: 0, sourcesNormalized: 0 };
  }

  // Keep `version` as the first key so the on-disk shape is predictable
  const { version, ...rest } = doc as { version?: unknown; [k: string]: unknown };
  const ordered: Record<string, unknown> = { version, ...rest };
  const content = yaml.dump(ordered, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return { migrated: true, annotationsRemapped, sourcesNormalized };
}

/**
 * Walks the shared + personal stores under `workspacePath` and migrates every
 * YAML file in place. Components live at `.codediary/components/*.yaml` and
 * are also scanned — their annotations collection is absent so only the
 * version bump applies, but that keeps them consistent.
 */
export function migrateWorkspace(workspacePath: string, personalRelative = '.vscode/codediary.yaml'): MigrationReport {
  const report: MigrationReport = {
    filesScanned: 0,
    filesWritten: 0,
    annotationsRemapped: 0,
    sourcesNormalized: 0,
  };

  const sharedRoot = path.join(workspacePath, '.codediary');
  if (fs.existsSync(sharedRoot)) {
    walkYaml(sharedRoot, (file) => {
      report.filesScanned++;
      const result = migrateYamlFile(file);
      if (result.migrated) { report.filesWritten++; }
      report.annotationsRemapped += result.annotationsRemapped;
      report.sourcesNormalized += result.sourcesNormalized;
    });
  }

  const personalPath = path.join(workspacePath, personalRelative);
  if (fs.existsSync(personalPath)) {
    report.filesScanned++;
    const result = migrateYamlFile(personalPath);
    if (result.migrated) { report.filesWritten++; }
    report.annotationsRemapped += result.annotationsRemapped;
    report.sourcesNormalized += result.sourcesNormalized;
  }

  return report;
}

function walkYaml(dir: string, visit: (filePath: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkYaml(full, visit);
    } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
      visit(full);
    }
  }
}
