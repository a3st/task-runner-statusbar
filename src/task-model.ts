import type * as vscode from 'vscode';
import type { Translator } from './localization';

type VSCodeApi = typeof vscode;

function scopeKey(task: vscode.Task): string {
  return typeof task.scope === 'object' && task.scope !== null
    ? task.scope.uri.toString()
    : String(task.scope);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

export function taskKey(task: vscode.Task): string {
  return JSON.stringify([scopeKey(task), task.source, task.name, stableValue(task.definition)]);
}

export function scopeLabel(task: vscode.Task, api: VSCodeApi, t: Translator): string {
  if (typeof task.scope === 'object' && task.scope !== null) return task.scope.name;
  return t(task.scope === api.TaskScope.Global ? 'scope.user' : 'scope.workspace');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// fetchTasks also returns auto-detected tasks. Include provider tasks only when
// they match an entry explicitly configured in tasks.json.
function isConfiguredTask(task: vscode.Task, api: VSCodeApi): boolean {
  if (task.source === 'Workspace' || task.source === 'User') return true;
  const resource = typeof task.scope === 'object' && task.scope !== null ? task.scope.uri : undefined;
  const inspected = api.workspace.getConfiguration('tasks', resource).inspect<unknown[]>('tasks');
  const entries = task.scope === api.TaskScope.Global
    ? inspected?.globalValue
    : resource
      ? inspected?.workspaceFolderValue ?? inspected?.workspaceValue
      : inspected?.workspaceValue;
  if (!Array.isArray(entries)) return false;
  const definition: Readonly<Record<string, unknown>> = task.definition;
  return entries.some((entry: unknown) => {
    if (!isRecord(entry)) return false;
    if (entry.type && entry.type !== definition.type) return false;
    if (entry.label) return entry.label === task.name;
    const keys = Object.keys(definition).filter(key => key !== 'type' && !key.startsWith('_') && key in entry);
    return keys.length > 0 && keys.every(key =>
      JSON.stringify(stableValue(entry[key])) === JSON.stringify(stableValue(definition[key])));
  });
}

export function configuredTasks(tasks: readonly vscode.Task[], api: VSCodeApi): vscode.Task[] {
  const seen = new Set<string>();
  return tasks.filter(task => {
    const key = taskKey(task);
    if (seen.has(key) || !isConfiguredTask(task, api)) return false;
    seen.add(key);
    return true;
  });
}

export function defaultTask(tasks: readonly vscode.Task[]): vscode.Task | undefined {
  return tasks.find(task => task.group?.isDefault) ?? tasks[0];
}

export function statusLabel(task: vscode.Task): string {
  // Task labels are user supplied; don't interpret them as status bar icons.
  return task.name.replace(/\$\(/g, '\uFF04(').replace(/[\r\n\t]/g, ' ');
}
