'use strict';

const english = require('../package.nls.json');
const russian = require('../package.nls.ru.json');

function createLocalizer(language) {
  // VS Code normally reports "en" / "ru"; also accept regional variants.
  const locale = String(language ?? 'en-US').toLowerCase().replace(/_/g, '-');
  const messages = locale === 'ru' || locale.startsWith('ru-') ? russian : english;
  return function translate(key, ...args) {
    const template = messages[key] ?? english[key];
    if (template === undefined) throw new Error(`Unknown localization key: ${key}`);
    // A replacement callback keeps task names containing "$&" or placeholders literal.
    return template.replace(/\{(\d+)\}/g, (placeholder, index) =>
      args[index] === undefined ? placeholder : String(args[index]));
  };
}

module.exports = { createLocalizer };
