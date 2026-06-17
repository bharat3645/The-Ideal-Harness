/**
 * Variable substitution for skill templates.
 *
 * Templates use `{{VAR}}` placeholders. Substitution is the only transform here;
 * partials/includes and filesystem access live in the CLI layer so this stays a
 * pure string→string function (easy to test, no I/O).
 */

const PLACEHOLDER = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

export type TemplateVars = Readonly<Record<string, string>>;

export interface RenderOptions {
  /** When true, an unknown placeholder is an error; otherwise it's left as-is. */
  readonly strict?: boolean;
}

export interface RenderResult {
  readonly text: string;
  /** Placeholders present in the template that had no matching variable. */
  readonly missing: readonly string[];
}

/** List every distinct `{{VAR}}` placeholder in a template. */
export function findPlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    found.add(match[1] as string);
  }
  return [...found];
}

/** Substitute `{{VAR}}` placeholders. Throws in strict mode on a missing var. */
export function renderTemplate(template: string, vars: TemplateVars, options: RenderOptions = {}): RenderResult {
  const missing = new Set<string>();
  const text = template.replace(PLACEHOLDER, (whole, name: string) => {
    if (Object.hasOwn(vars, name)) {
      return vars[name] as string;
    }
    missing.add(name);
    return whole;
  });
  if (options.strict === true && missing.size > 0) {
    throw new Error(`template has unresolved placeholders: ${[...missing].join(', ')}`);
  }
  return { text, missing: [...missing] };
}
