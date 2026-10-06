import type * as vscode from 'vscode';
import { taskKey, configuredTasks, defaultTask, scopeLabel, statusLabel } from './task-model';
import { createLocalizer } from './localization';

type VSCodeApi = typeof vscode;
type ControllerContext = Pick<vscode.ExtensionContext, 'subscriptions' | 'workspaceState'>;

interface TaskPickItem extends vscode.QuickPickItem {
  task: vscode.Task;
}

export interface TaskController {
  refresh(): Promise<boolean>;
  pickTask(): Promise<vscode.Task | undefined>;
  runTask(): Promise<void>;
  ready: Promise<boolean>;
}
const SELECTION_KEY = 'selectedTask';

export function createController(api: VSCodeApi, context: ControllerContext): TaskController {
  const t = createLocalizer(api.env?.language);
  // VS Code's Problems counter uses priority 50 (visibility indicator: 49).
  // Lower priorities appear to its right in the left status bar group.
  const select = api.window.createStatusBarItem('taskRunner.select', api.StatusBarAlignment.Left, 48);
  const run = api.window.createStatusBarItem('taskRunner.run', api.StatusBarAlignment.Left, 47);
  const output = api.window.createOutputChannel('Task Runner');
  select.name = t('status.selectName');
  run.name = t('status.runName');
  select.command = 'taskRunner.selectTask';
  let tasks: vscode.Task[] = [];
  let selected: vscode.Task | undefined;
  let selectedKey = context.workspaceState.get<string>(SELECTION_KEY);
  let revision = 0;
  let disposed = false;
  let starting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let refreshError: string | undefined;

  function render(): void {
    if (disposed) return;
    const currentTask = selected;
    const running = currentTask && api.tasks.taskExecutions.some(execution => taskKey(execution.task) === taskKey(currentTask));
    select.text = `${selected ? t('status.selectedTask', statusLabel(selected)) : t('status.task')} $(chevron-down)`;
    select.tooltip = refreshError ? t('status.loadError', refreshError) : selected
      ? t('status.selectedTooltip', selected.name, scopeLabel(selected, api, t))
      : t('status.selectTooltip');
    run.text = starting || running ? '$(loading~spin)' : '$(play)';
    run.tooltip = starting ? t('status.starting') : running && selected
      ? t('status.running', selected.name)
      : selected ? t('status.runTooltip', selected.name) : t('status.selectAndRun');
    run.command = starting ? undefined : 'taskRunner.runTask';
    select.accessibilityInformation = { label: selected ? t('status.selectedAccessibility', selected.name) : t('status.selectAccessibility'), role: 'button' };
    run.accessibilityInformation = { label: run.tooltip, role: 'button' };
    select.show();
    run.show();
  }

  function logError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`[${new Date().toISOString()}] ${message}`);
    return message;
  }

  async function refresh(): Promise<boolean> {
    const currentRevision = ++revision;
    try {
      const fetched = await api.tasks.fetchTasks();
      if (disposed || currentRevision !== revision) return false;
      tasks = configuredTasks(fetched, api);
      selected = tasks.find(task => taskKey(task) === selectedKey) ?? defaultTask(tasks);
      selectedKey = selected ? taskKey(selected) : undefined;
      refreshError = undefined;
      render();
      return true;
    } catch (error) {
      if (disposed || currentRevision !== revision) return false;
      refreshError = logError(error);
      render();
      return false;
    }
  }

  function scheduleRefresh(): void {
    clearTimeout(timer);
    timer = setTimeout(() => { void refresh(); }, 250);
  }

  async function pickTask(): Promise<vscode.Task | undefined> {
    if (!await refresh()) {
      await api.window.showErrorMessage(t('error.message', refreshError ?? t('error.retrySelection')));
      return undefined;
    }
    if (!tasks.length) {
      const action = await api.window.showInformationMessage(t('tasks.empty'), t('tasks.configure'));
      if (action) await api.commands.executeCommand('workbench.action.tasks.configureTaskRunner');
      return undefined;
    }
    const choice = await api.window.showQuickPick<TaskPickItem>(tasks.map(task => ({
      label: task.name,
      description: scopeLabel(task, api, t),
      detail: task.detail,
      picked: taskKey(task) === selectedKey,
      task
    })), {
      title: t('picker.title'),
      placeHolder: t('picker.placeholder'),
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!choice || disposed) return undefined;
    // A watcher may have refreshed the list while the picker was open.
    const chosenTask = tasks.find(task => taskKey(task) === taskKey(choice.task));
    if (!chosenTask) {
      await api.window.showInformationMessage(t('tasks.changed'));
      return undefined;
    }
    selected = chosenTask;
    selectedKey = taskKey(selected);
    await context.workspaceState.update(SELECTION_KEY, selectedKey);
    render();
    return selected;
  }

  async function runTask(): Promise<void> {
    if (starting || disposed) return;
    if (!api.workspace.isTrusted) {
      await api.window.showInformationMessage(t('tasks.trustRequired'));
      return;
    }
    starting = true;
    render();
    try {
      const previousKey = selectedKey;
      if (!await refresh()) throw new Error(refreshError ?? t('error.retryRun'));
      if (previousKey && selectedKey !== previousKey) {
        await api.window.showInformationMessage(t('tasks.selectedChanged'));
        return;
      }
      const task = selected ?? await pickTask();
      if (!task || disposed) return;
      await context.workspaceState.update(SELECTION_KEY, taskKey(task));
      // Execute the original VS Code Task, retaining dependencies, inputs,
      // problem matchers, platform overrides and terminal presentation.
      await api.tasks.executeTask(task);
    } catch (error) {
      await api.window.showErrorMessage(t('error.message', logError(error)));
    } finally {
      starting = false;
      render();
    }
  }

  const watcher = api.workspace.createFileSystemWatcher('**/.vscode/tasks.json');
  const workspaceWatcher = api.workspace.createFileSystemWatcher('**/*.code-workspace');
  context.subscriptions.push(select, run, output, watcher, workspaceWatcher,
    watcher.onDidCreate(scheduleRefresh), watcher.onDidChange(scheduleRefresh), watcher.onDidDelete(scheduleRefresh),
    workspaceWatcher.onDidChange(scheduleRefresh), workspaceWatcher.onDidDelete(scheduleRefresh),
    api.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('tasks')) scheduleRefresh(); }),
    api.workspace.onDidChangeWorkspaceFolders(scheduleRefresh),
    api.tasks.onDidStartTask(render), api.tasks.onDidEndTask(render),
    api.commands.registerCommand('taskRunner.selectTask', pickTask),
    api.commands.registerCommand('taskRunner.runTask', runTask),
    api.commands.registerCommand('taskRunner.refreshTasks', async () => {
      if (!await refresh()) await api.window.showErrorMessage(t('error.message', refreshError ?? t('error.retryRefresh')));
    }),
    { dispose() { disposed = true; ++revision; clearTimeout(timer); } }
  );
  render();
  return { refresh, pickTask, runTask, ready: refresh() };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Load the editor API lazily so unit tests can inject their own API.
  const api: VSCodeApi = require('vscode');
  await createController(api, context).ready;
}
