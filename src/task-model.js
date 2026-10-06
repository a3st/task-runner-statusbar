'use strict';

function scopeKey(task) {
  return typeof task.scope === 'object' && task.scope !== null
    ? task.scope.uri.toString()
    : String(task.scope);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function taskKey(task) {
  return JSON.stringify([scopeKey(task), task.source, task.name, stableValue(task.definition)]);
}

function scopeLabel(task, api, t) {
  if (typeof task.scope === 'object' && task.scope !== null) return task.scope.name;
  return t(task.scope === api.TaskScope.Global ? 'scope.user' : 'scope.workspace');
}

// fetchTasks also returns auto-detected tasks. Include provider tasks only when
// they match an entry explicitly configured in tasks.json.
function isConfiguredTask(task, api) {
  if (task.source === 'Workspace' || task.source === 'User') return true;
  const resource = typeof task.scope === 'object' && task.scope !== null ? task.scope.uri : undefined;
  const inspected = api.workspace.getConfiguration('tasks', resource).inspect('tasks');
  const entries = task.scope === api.TaskScope.Global
    ? inspected?.globalValue
    : resource
      ? inspected?.workspaceFolderValue ?? inspected?.workspaceValue
      : inspected?.workspaceValue;
  if (!Array.isArray(entries)) return false;
  return entries.some(entry => {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.type && entry.type !== task.definition.type) return false;
    if (entry.label) return entry.label === task.name;
    const keys = Object.keys(task.definition).filter(key => key !== 'type' && !key.startsWith('_') && key in entry);
    return keys.length > 0 && keys.every(key =>
      JSON.stringify(stableValue(entry[key])) === JSON.stringify(stableValue(task.definition[key])));
  });
}

function configuredTasks(tasks, api) {
  const seen = new Set();
  return tasks.filter(task => {
    const key = taskKey(task);
    if (seen.has(key) || !isConfiguredTask(task, api)) return false;
    seen.add(key);
    return true;
  });
}

function defaultTask(tasks) {
  return tasks.find(task => task.group?.isDefault) ?? tasks[0];
}

function statusLabel(task) {
  // Task labels are user supplied; don't interpret them as status bar icons.
  return task.name.replace(/\$\(/g, '＄(').replace(/[\r\n\t]/g, ' ');
}

module.exports = { taskKey, configuredTasks, defaultTask, scopeLabel, statusLabel };
