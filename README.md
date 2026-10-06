<div align="center">
  <img src="assets/icon.png" alt="Task Runner" width="96" height="96">
  <h1>Task Runner Status Bar</h1>
  <p>Your VS Code tasks, one click away.</p>
  <p><strong>English</strong> · <a href="README.ru-RU.md">Русский</a></p>
</div>

Select a task from `tasks.json` in the status bar and run it with the adjacent play button.

```text
  ⓧ 0  ⚠ 0    Task: Build ▾    ▶
```

- Search tasks with VS Code's Quick Pick.
- Keep your selection per workspace.
- Refresh automatically when `tasks.json` changes.
- Run tasks across workspace folders, including `dependsOn` tasks.

English and Russian UI follow the editor's display language. Requires **VS Code 1.85+**.

## Install & use

Open **Extensions → … → Install from VSIX…** and select the `.vsix` file. Open a project with `.vscode/tasks.json`.

Click **Task ▾**, choose a task, then click **▶** to run it. The controls sit to the right of the error and warning counters.

## Development

TypeScript · Node.js 22+ · npm

```sh
npm ci
npm run check
npm test
npm run package
```

Press **F5** in VS Code to debug. Tests and packaging compile automatically; the `.vsix` is created in the project root. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

---

By **a3st** · [MIT License](LICENSE)
