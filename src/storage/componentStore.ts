import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as fs from 'fs';
import { Component, isValidComponentId } from '../models/component';
import { normalizeSource } from '../models/annotation';
import { SCHEMA_VERSION } from './schema';

/**
 * Per-component YAML storage under `.codediary/components/`, committed to git.
 *
 * One YAML per component (filename = `<id>.yaml`) keeps merge conflicts
 * scoped: two devs editing different components never collide.
 *
 * This store owns CRUD and file-list mutations. The reverse file→components
 * index is derived by {@link DiaryStore} at read time.
 */

const COMPONENTS_DIR = 'components';

function normalizeComponent(raw: unknown): Component | null {
  if (!raw || typeof raw !== 'object') { return null; }
  const r = raw as Record<string, unknown>;
  if (!isValidComponentId(r.id)) { return null; }
  if (typeof r.name !== 'string' || !r.name.trim()) { return null; }
  if (typeof r.created_at !== 'string') { return null; }
  const files = Array.isArray(r.files)
    ? r.files.filter((f): f is string => typeof f === 'string')
    : [];
  return {
    id: r.id,
    name: r.name.trim(),
    description: typeof r.description === 'string' ? r.description : undefined,
    owners: Array.isArray(r.owners)
      ? r.owners.filter((o): o is string => typeof o === 'string')
      : undefined,
    files,
    source: normalizeSource(r.source),
    created_at: r.created_at,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : r.created_at,
    author: typeof r.author === 'string' ? r.author : undefined,
  };
}

export class ComponentStore {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private basePath: string | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private cache = new Map<string, Component>();

  constructor() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) { return; }
    const candidatePath = path.join(workspaceFolder.uri.fsPath, '.codediary', COMPONENTS_DIR);
    if (fs.existsSync(candidatePath)) {
      try {
        const realPath = fs.realpathSync(candidatePath);
        const realWorkspace = fs.realpathSync(workspaceFolder.uri.fsPath);
        if (!realPath.startsWith(realWorkspace + path.sep) && realPath !== realWorkspace) {
          return; // symlink escapes workspace
        }
      } catch { return; }
    }
    this.basePath = candidatePath;
    this.loadAll();
    this.setupWatcher();
  }

  private setupWatcher(): void {
    if (!this.basePath) { return; }
    const pattern = new vscode.RelativePattern(this.basePath, '*.yaml');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const reload = () => {
      this.loadAll();
      this._onDidChange.fire();
    };
    this.watcher.onDidChange(reload);
    this.watcher.onDidCreate(reload);
    this.watcher.onDidDelete(reload);
  }

  private yamlPath(id: string): string {
    if (!isValidComponentId(id)) {
      throw new Error(`Invalid component id: ${id}`);
    }
    const resolved = path.resolve(this.basePath!, `${id}.yaml`);
    if (!resolved.startsWith(this.basePath! + path.sep)) {
      throw new Error(`Path traversal detected: ${id}`);
    }
    return resolved;
  }

  private loadAll(): void {
    this.cache.clear();
    if (!this.basePath || !fs.existsSync(this.basePath)) { return; }
    for (const entry of fs.readdirSync(this.basePath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.yaml')) { continue; }
      const fullPath = path.join(this.basePath, entry.name);
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const parsed = yaml.load(raw);
        if (!parsed || typeof parsed !== 'object') { continue; }
        // Strip version marker before normalization
        const { version: _v, ...payload } = parsed as Record<string, unknown>;
        const component = normalizeComponent(payload);
        if (component) { this.cache.set(component.id, component); }
      } catch { /* skip malformed */ }
    }
  }

  private writeComponent(component: Component): void {
    if (!this.basePath) { return; }
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
    // Re-check symlink safety before writing
    try {
      const realDir = fs.realpathSync(this.basePath);
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (wsFolder) {
        const realWorkspace = fs.realpathSync(wsFolder.uri.fsPath);
        if (!realDir.startsWith(realWorkspace + path.sep) && realDir !== realWorkspace) {
          return;
        }
      }
    } catch { return; }
    const filePath = this.yamlPath(component.id);
    const payload = { version: SCHEMA_VERSION, ...component };
    const content = yaml.dump(payload, { lineWidth: 120, noRefs: true });
    fs.writeFileSync(filePath, content, 'utf8');
    this.cache.set(component.id, component);
  }

  // --- Queries ---

  getAll(): Component[] {
    return [...this.cache.values()];
  }

  get(id: string): Component | undefined {
    return this.cache.get(id);
  }

  has(id: string): boolean {
    return this.cache.has(id);
  }

  /** Returns component ids that include the given workspace-relative file path. */
  getComponentsForFile(file: string): Component[] {
    const matches: Component[] = [];
    for (const c of this.cache.values()) {
      if (c.files.includes(file)) { matches.push(c); }
    }
    return matches;
  }

  // --- Mutations ---

  upsert(component: Component): void {
    if (!this.basePath) { return; }
    if (!isValidComponentId(component.id)) {
      throw new Error(`Invalid component id: ${component.id}`);
    }
    const existing = this.cache.get(component.id);
    const now = new Date().toISOString();
    const next: Component = {
      ...component,
      updated_at: now,
      created_at: existing?.created_at ?? component.created_at ?? now,
    };
    this.writeComponent(next);
    this._onDidChange.fire();
  }

  delete(id: string): boolean {
    if (!this.basePath) { return false; }
    if (!this.cache.has(id)) { return false; }
    const filePath = this.yamlPath(id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    this.cache.delete(id);
    this._onDidChange.fire();
    return true;
  }

  /** Adds a file to a component's file list (no-op if already present). */
  addFile(componentId: string, file: string): void {
    const existing = this.cache.get(componentId);
    if (!existing) { throw new Error(`Unknown component: ${componentId}`); }
    if (existing.files.includes(file)) { return; }
    this.writeComponent({
      ...existing,
      files: [...existing.files, file],
      updated_at: new Date().toISOString(),
    });
    this._onDidChange.fire();
  }

  /** Removes a file from a component's file list (no-op if not present). */
  removeFile(componentId: string, file: string): void {
    const existing = this.cache.get(componentId);
    if (!existing) { return; }
    if (!existing.files.includes(file)) { return; }
    this.writeComponent({
      ...existing,
      files: existing.files.filter(f => f !== file),
      updated_at: new Date().toISOString(),
    });
    this._onDidChange.fire();
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }
}
