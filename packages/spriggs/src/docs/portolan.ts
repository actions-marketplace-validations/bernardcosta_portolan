import { join } from "node:path";
import { parse } from "yaml";

/** docs/portolan.yml. Only `name` is required. Unknown keys are kept: people add fields by hand. */
export type PortolanConfig = {
  name: string;
  repo?: string;
  owner?: string;
  issues?: { pattern?: string; url?: string };
  chat?: { url?: string };
  specs?: string[];
  [key: string]: unknown;
};

export function parsePortolanYml(text: string): { config?: PortolanConfig; errors: string[] } {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    return { errors: [`portolan.yml does not parse: ${(e as Error).message}`] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { errors: ["portolan.yml must be a mapping"] };
  }
  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof obj.name !== "string" || !obj.name.trim())
    errors.push("portolan.yml: name is required");
  for (const key of ["repo", "owner"]) {
    if (obj[key] !== undefined && typeof obj[key] !== "string")
      errors.push(`portolan.yml: ${key} must be a string`);
  }
  const issues = obj.issues as Record<string, unknown> | undefined;
  if (issues?.pattern !== undefined) {
    try {
      new RegExp(String(issues.pattern));
    } catch {
      errors.push("portolan.yml: issues.pattern is not a valid regular expression");
    }
  }
  if (errors.length) return { errors };
  return { config: obj as PortolanConfig, errors };
}

/** Reads docs/portolan.yml under cwd. Returns undefined when the file does not exist. */
export async function loadPortolanConfig(
  cwd = process.cwd(),
): Promise<{ config?: PortolanConfig; errors: string[] }> {
  const file = Bun.file(join(cwd, "docs", "portolan.yml"));
  if (!(await file.exists())) return { errors: [] };
  return parsePortolanYml(await file.text());
}
