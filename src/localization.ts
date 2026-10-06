type TranslationCatalog = typeof import('../package.nls.json');
export type TranslationKey = keyof TranslationCatalog;
export type Translator = (key: TranslationKey, ...args: readonly (string | number | boolean)[]) => string;

const english: TranslationCatalog = require('../package.nls.json');
const russian: TranslationCatalog = require('../package.nls.ru.json');

export function createLocalizer(language: string | undefined): Translator {
  // VS Code normally reports "en" / "ru"; also accept regional variants.
  const locale = String(language ?? 'en-US').toLowerCase().replace(/_/g, '-');
  const messages = locale === 'ru' || locale.startsWith('ru-') ? russian : english;
  return function translate(key, ...args): string {
    const template = messages[key] ?? english[key];
    if (template === undefined) throw new Error(`Unknown localization key: ${key}`);
    // A callback keeps task names containing "$&" or placeholders literal.
    return template.replace(/\{(\d+)\}/g, (placeholder: string, index: string) => {
      const value = args[Number(index)];
      return value === undefined ? placeholder : String(value);
    });
  };
}
