export const toKebabCase = (str: string): string =>
  str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();

export const toPascalCase = (str: string): string =>
  str
    .replace(/(?:^|-|_)(\w)/g, (_, c) => c.toUpperCase())
    .replace(/-/g, '');