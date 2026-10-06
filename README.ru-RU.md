<div align="center">
  <img src="assets/icon.png" alt="Task Runner" width="96" height="96">
  <h1>Task Runner Status Bar</h1>
  <p>Задачи VS Code — в одном клике.</p>
  <p><a href="README.md">English</a> · <strong>Русский</strong></p>
</div>

Выбирайте задачи из `tasks.json` в строке состояния и запускайте их кнопкой рядом.

```text
  ⓧ 0  ⚠ 0    Задача: Build ▾    ▶
```

- Поиск задач через стандартный Quick Pick VS Code.
- Сохранение выбранной задачи для рабочей области.
- Автоматическое обновление при изменении `tasks.json`.
- Задачи из разных папок, включая составные задачи с `dependsOn`.

Английский и русский интерфейс переключаются по языку редактора. Требуется **VS Code 1.85+**.

## Установка и использование

Откройте **Extensions → … → Install from VSIX…** и выберите файл `.vsix`. Откройте проект с `.vscode/tasks.json`.

Нажмите **Задача ▾**, выберите задачу, затем нажмите **▶**. Кнопки находятся справа от счётчиков ошибок и предупреждений.

## Разработка

TypeScript · Node.js 22+ · npm

```sh
npm ci
npm run check
npm test
npm run package
```

Нажмите **F5** в VS Code для отладки. Тесты и упаковка запускают компиляцию автоматически; файл `.vsix` создаётся в корне проекта. На Windows используйте `npm.cmd`, если PowerShell блокирует `npm.ps1`.

---

Автор — **a3st** · [Лицензия MIT](LICENSE)
