/** Replaces every `{{key}}` in `template` with `vars[key]`. Throws on an unmatched placeholder. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    if (value === undefined) {
      throw new Error(`Missing template variable "${key}" for placeholder ${match}`);
    }
    return value;
  });
}
