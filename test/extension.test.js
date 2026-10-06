'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../dist/extension');
const { configuredTasks, taskKey } = require('../dist/task-model');
const { createLocalizer } = require('../dist/localization');

function event() {
  const listeners = new Set();
  const subscribe = callback => {
    listeners.add(callback);
    return { dispose: () => listeners.delete(callback) };
  };
  subscribe.fire = value => { for (const callback of listeners) callback(value); };
  return subscribe;
}

function folder(name) {
  return { name, uri: { toString: () => `file:///project/${name}` } };
}

function task(name, overrides = {}) {
  return { name, source: 'Workspace', scope: folder('app'), definition: { type: 'shell', id: name }, ...overrides };
}

function fixture(t, initialTasks = [], savedKey, language = 'en-US') {
  const state = { tasks: initialTasks, bars: [], executed: [], errors: [], infos: [], logs: [], registered: new Map(), configured: new Map(), watchers: [], pickCalls: 0 };
  const context = {
    subscriptions: [],
    workspaceState: {
      get: () => state.savedKey ?? savedKey,
      update: async (key, value) => { state.savedKey = value; }
    }
  };
  const api = {
    env: { language },
    StatusBarAlignment: { Left: 1 },
    TaskScope: { Global: 1, Workspace: 2 },
    window: {
      createStatusBarItem: (id, alignment, priority) => {
        const bar = { id, alignment, priority, show() { this.visible = true; }, dispose() {} };
        state.bars.push(bar);
        return bar;
      },
      createOutputChannel: () => ({ appendLine: line => state.logs.push(line), dispose() {} }),
      showQuickPick: async (items, options) => {
        state.pickCalls++;
        state.items = items;
        state.pickOptions = options;
        return state.pick ? state.pick(items) : undefined;
      },
      showErrorMessage: async message => { state.errors.push(message); },
      showInformationMessage: async (message, ...actions) => { state.infos.push(message); state.infoActions = actions; return state.infoChoice; }
    },
    commands: {
      registerCommand: (id, callback) => {
        state.registered.set(id, callback);
        return { dispose: () => state.registered.delete(id) };
      },
      executeCommand: async id => { state.lastCommand = id; }
    },
    workspace: {
      isTrusted: true,
      getConfiguration: (section, resource) => ({ inspect: () => state.configured.get(resource?.toString() ?? 'workspace') }),
      createFileSystemWatcher: pattern => {
        const watcher = { pattern, onDidCreate: event(), onDidChange: event(), onDidDelete: event(), dispose() {} };
        state.watchers.push(watcher);
        return watcher;
      },
      onDidChangeConfiguration: event(),
      onDidChangeWorkspaceFolders: event()
    },
    tasks: {
      taskExecutions: [],
      fetchTasks: async () => state.tasks,
      executeTask: async value => {
        if (state.runError) throw state.runError;
        state.executed.push(value);
        return { task: value };
      },
      onDidStartTask: event(),
      onDidEndTask: event()
    }
  };
  const controller = createController(api, context);
  t.after(() => { for (const disposable of context.subscriptions) disposable.dispose(); });
  return { state, api, context, controller };
}

test('status bar has an adjacent task selector and play button; default build is selected', async t => {
  const build = task('Build', { group: { isDefault: true } });
  const { state, controller } = fixture(t, [task('Lint'), build]);
  await controller.ready;
  assert.equal(state.bars[0].text, 'Task: Build $(chevron-down)');
  assert.equal(state.bars[1].text, '$(play)');
  assert.equal(state.bars[0].priority - state.bars[1].priority, 1);
  assert.equal(state.bars[0].command, 'taskRunner.selectTask');
  assert.equal(state.bars[1].command, 'taskRunner.runTask');
  assert.ok(state.bars.every(bar => bar.visible));
});

test('picking saves the selection without running; play runs the original task object', async t => {
  const target = task('Test', { detail: 'Unit tests', presentationOptions: { panel: 'dedicated' } });
  const { state, controller } = fixture(t, [task('Build'), target]);
  await controller.ready;
  state.pick = items => items[1];
  await controller.pickTask();
  assert.equal(state.savedKey, taskKey(target));
  assert.equal(state.executed.length, 0);
  assert.equal(state.bars[0].text, 'Task: Test $(chevron-down)');
  await controller.runTask();
  assert.equal(state.executed[0], target);
});

test('restores a saved selection in the correct folder with duplicate task names', async t => {
  const first = task('Build', { scope: folder('frontend') });
  const second = task('Build', { scope: folder('backend') });
  const { state, controller } = fixture(t, [first, second], taskKey(second));
  await controller.ready;
  await controller.runTask();
  assert.equal(state.executed[0], second);
  state.pick = items => items[0];
  await controller.pickTask();
  assert.deepEqual(state.items.map(item => item.description), ['frontend', 'backend']);
});

test('cancel leaves the task selection unchanged', async t => {
  const { state, controller } = fixture(t, [task('Build'), task('Test')]);
  await controller.ready;
  await controller.pickTask();
  assert.equal(state.bars[0].text, 'Task: Build $(chevron-down)');
  assert.equal(state.executed.length, 0);
});

test('refresh replaces the task object so a modified command is used on next run', async t => {
  const original = task('Build', { execution: { command: 'old' } });
  const replacement = task('Build', { execution: { command: 'new' } });
  const { state, controller } = fixture(t, [original]);
  await controller.ready;
  state.tasks = [replacement];
  await controller.runTask();
  assert.equal(state.executed[0], replacement);
});

test('removing a selected task before play does not run a different task', async t => {
  const { state, controller } = fixture(t, [task('Build'), task('Test')]);
  await controller.ready;
  state.tasks = [task('Test')];
  await controller.runTask();
  assert.equal(state.executed.length, 0);
  assert.match(state.infos[0], /removed/);
  assert.equal(state.bars[0].text, 'Task: Test $(chevron-down)');
});

test('empty list provides configure-tasks action and never executes anything', async t => {
  const { state, controller } = fixture(t);
  await controller.ready;
  state.infoChoice = 'Configure Tasks';
  await controller.runTask();
  assert.equal(state.bars[0].text, 'Task $(chevron-down)');
  assert.equal(state.lastCommand, 'workbench.action.tasks.configureTaskRunner');
  assert.equal(state.executed.length, 0);
});

test('provider tasks must match configured labels or definitions; auto-detected tasks are omitted', async t => {
  const { state, api, controller } = fixture(t);
  await controller.ready;
  const build = task('npm: build', { source: 'npm', definition: { type: 'npm', script: 'build', path: '' } });
  const lint = task('npm: lint', { source: 'npm', definition: { type: 'npm', script: 'lint', path: '' } });
  const nested = task('npm: build nested', { source: 'npm', definition: { type: 'npm', script: 'build', path: 'nested' } });
  state.configured.set(build.scope.uri.toString(), { workspaceFolderValue: [{ type: 'npm', script: 'build', path: '' }] });
  assert.deepEqual(configuredTasks([build, lint, nested, build], api), [build]);
  state.configured.set(build.scope.uri.toString(), { workspaceFolderValue: [{ type: 'npm', label: lint.name }] });
  assert.deepEqual(configuredTasks([build, lint], api), [lint]);
});

test('compound tasks are passed untouched to VS Code even without an execution', async t => {
  const compound = task('All', { definition: { type: '$composite', id: 'All' } });
  const { state, controller } = fixture(t, [compound]);
  await controller.ready;
  await controller.runTask();
  assert.equal(state.executed[0], compound);
});

test('running task events change the play indicator and restore it after completion', async t => {
  const selected = task('Build');
  const { state, api, controller } = fixture(t, [selected]);
  await controller.ready;
  api.tasks.taskExecutions = [{ task: selected }];
  api.tasks.onDidStartTask.fire();
  assert.equal(state.bars[1].text, '$(loading~spin)');
  api.tasks.taskExecutions = [];
  api.tasks.onDidEndTask.fire();
  assert.equal(state.bars[1].text, '$(play)');
});

test('task execution failures are reported and play button recovers', async t => {
  const { state, controller } = fixture(t, [task('Build')]);
  await controller.ready;
  state.runError = new Error('Missing executable');
  await controller.runTask();
  assert.match(state.errors[0], /Missing executable/);
  assert.match(state.logs[0], /Missing executable/);
  assert.equal(state.bars[1].text, '$(play)');
  assert.equal(state.bars[1].command, 'taskRunner.runTask');
});

test('fetch failure prevents execution of a stale task', async t => {
  const { state, api, controller } = fixture(t, [task('Build')]);
  await controller.ready;
  api.tasks.fetchTasks = async () => { throw new Error('Provider unavailable'); };
  await controller.runTask();
  assert.equal(state.executed.length, 0);
  assert.match(state.errors[0], /Provider unavailable/);
});

test('untrusted workspaces cannot execute tasks', async t => {
  const { state, api, controller } = fixture(t, [task('Build')]);
  await controller.ready;
  api.workspace.isTrusted = false;
  await controller.runTask();
  assert.equal(state.executed.length, 0);
  assert.match(state.infos[0], /Trust/);
});

test('task file changes refresh the status bar automatically', async t => {
  const { state, controller } = fixture(t, [task('Build')]);
  await controller.ready;
  state.tasks = [task('New task')];
  state.watchers[0].onDidChange.fire();
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(state.bars[0].text, 'Task: New task $(chevron-down)');
  state.tasks = [];
  state.watchers[0].onDidDelete.fire();
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(state.bars[0].text, 'Task $(chevron-down)');
});

test('a slow older refresh never overwrites the latest task list', async t => {
  const { state, api, controller } = fixture(t, [task('Initial')]);
  await controller.ready;
  let resolveOld;
  api.tasks.fetchTasks = () => new Promise(resolve => { resolveOld = resolve; });
  const oldRefresh = controller.refresh();
  api.tasks.fetchTasks = async () => [task('Latest')];
  await controller.refresh();
  resolveOld([task('Old')]);
  await oldRefresh;
  assert.equal(state.bars[0].text, 'Task: Latest $(chevron-down)');
});

test('rapid double-click launches once while execution is being started', async t => {
  const { state, api, controller } = fixture(t, [task('Build')]);
  await controller.ready;
  let finish;
  api.tasks.executeTask = async value => {
    state.executed.push(value);
    await new Promise(resolve => { finish = resolve; });
  };
  const first = controller.runTask();
  await new Promise(resolve => setImmediate(resolve));
  await controller.runTask();
  assert.equal(state.executed.length, 1);
  finish();
  await first;
});

test('icon-like text in task labels is displayed literally in the status bar', async t => {
  const { state, controller } = fixture(t, [task('Build $(alert)\nnow')]);
  await controller.ready;
  assert.equal(state.bars[0].text, 'Task: Build ＄(alert) now $(chevron-down)');
});

for (const language of ['en', 'en-US', 'ru', 'ru-RU', 'RU-ru', 'de']) {
  test(`editor language ${language} localizes status, picker, scopes, messages and actions`, async t => {
    const russian = language.toLowerCase().startsWith('ru');
    const userTask = task('Build $& {0}', { scope: 1 });
    const workspaceTask = task('Проверка', { scope: 2, detail: 'Описание из tasks.json' });
    const { state, api, controller } = fixture(t, [userTask, workspaceTask], undefined, language);
    await controller.ready;
    assert.equal(state.bars[0].text, `${russian ? 'Задача' : 'Task'}: Build $& {0} $(chevron-down)`);
    assert.equal(state.bars[1].tooltip, `${russian ? 'Запустить' : 'Run'}: Build $& {0}`);
    assert.equal(state.bars[0].name, russian ? 'Task Runner: выбор задачи' : 'Task Runner: task selection');
    assert.equal(state.bars[0].accessibilityInformation.label,
      russian ? 'Выбрать задачу. Выбрана Build $& {0}' : 'Select a task. Selected: Build $& {0}');
    await controller.pickTask();
    assert.equal(state.pickOptions.title, russian ? 'Задача — выбрать задачу' : 'Task — select a task');
    assert.equal(state.pickOptions.placeHolder, russian
      ? 'Выберите задачу; кнопка ▶ внизу запустит её'
      : 'Select a task; the ▶ button in the status bar will run it');
    assert.deepEqual(state.items.map(item => item.description), russian
      ? ['Пользователь', 'Рабочая область'] : ['User', 'Workspace']);
    assert.equal(state.items[1].label, 'Проверка');
    assert.equal(state.items[1].detail, 'Описание из tasks.json');
    api.workspace.isTrusted = false;
    await controller.runTask();
    assert.equal(state.infos.at(-1), russian
      ? 'Для запуска задач разрешите доверие к рабочей области VS Code.'
      : 'Trust this VS Code workspace to run tasks.');
    api.workspace.isTrusted = true;
    state.tasks = [];
    await controller.pickTask();
    assert.deepEqual(state.infoActions, [russian ? 'Настроить задачи' : 'Configure Tasks']);
    assert.match(state.infos.at(-1), russian ? /нет доступных задач/ : /No tasks are available/);
    api.tasks.fetchTasks = async () => { throw new Error('provider error'); };
    await controller.refresh();
    assert.equal(state.bars[0].tooltip, russian
      ? 'Не удалось загрузить задачи: provider error' : 'Unable to load tasks: provider error');
  });
}

test('translation catalogs have matching keys and placeholders; manifest strings are translated', () => {
  const english = require('../package.nls.json');
  const russian = require('../package.nls.ru.json');
  const manifest = require('../package.json');
  assert.deepEqual(Object.keys(russian).sort(), Object.keys(english).sort());
  for (const key of Object.keys(english)) {
    assert.ok(russian[key].trim(), `Empty Russian translation: ${key}`);
    assert.deepEqual(russian[key].match(/\{\d+\}/g) ?? [], english[key].match(/\{\d+\}/g) ?? [], key);
  }
  for (const entry of [manifest.description, ...manifest.contributes.commands.map(command => command.title)]) {
    assert.match(entry, /^%[^%]+%$/);
    const key = entry.slice(1, -1);
    assert.ok(english[key]);
    assert.ok(russian[key]);
  }
});

test('missing language defaults to English; substitutions preserve task names literally', () => {
  assert.equal(createLocalizer(undefined)('status.task'), 'Task');
  assert.equal(createLocalizer('en-US')('status.selectedTask', '$& {0} $1'), 'Task: $& {0} $1');
  assert.equal(createLocalizer('ru-RU')('status.selectedTask', '$& {0} $1'), 'Задача: $& {0} $1');
});
