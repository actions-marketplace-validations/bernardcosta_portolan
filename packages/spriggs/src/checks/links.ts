import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { readableFile } from "../agent/tools";
import { splitFrontmatter } from "../docs/frontmatter";
import type { HardCheck } from "./index";

/**
 * Relative links in docs/ must point to a file that exists and, for a markdown page, to a heading on it.
 * Scope "run": only links from or to a page the model wrote, so a pull request is not filled with fixes
 * to links it did not touch. Scope "all": every link, for the survey, whose job is the whole doc set.
 * Change entries (history) and docs/api/ (generated) cannot be edited by the model and are not checked.
 */
export const deadLinks = (scope: "run" | "all" = "all"): HardCheck => ({
  name: "dead links",
  advice:
    "These links in docs/ point to a file or a heading that does not exist. Fix the link, or the heading it points to.",
  run: ({ rt }) => {
    if (!existsSync(join(rt.cwd, "docs"))) return [];
    const pages = readdirSync(join(rt.cwd, "docs"), { recursive: true, encoding: "utf8" })
      .map((p) => `docs/${p}`)
      .filter(
        (p) =>
          p.endsWith(".md") &&
          !p.startsWith("docs/changes/") &&
          !p.startsWith("docs/api/") &&
          readableFile(rt.cwd, p),
      );
    const read = (p: string) => readFileSync(join(rt.cwd, p), "utf8");
    const anchorCache = new Map<string, Set<string>>();
    const anchorsOf = (p: string) => {
      let set = anchorCache.get(p);
      if (!set) {
        set = readableFile(rt.cwd, p) ? anchors(read(p)) : new Set<string>();
        anchorCache.set(p, set);
      }
      return set;
    };

    const problems: string[] = [];
    for (const page of pages) {
      for (const href of links(read(page))) {
        if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) continue; // http:, mailto: and the like
        const [path = "", anchor] = href.split("#", 2);
        const target = path ? normalize(join(dirname(page), decode(path))) : page;
        if (scope === "run" && !rt.originals.has(page) && !rt.originals.has(target)) continue;
        if (target.startsWith("..") || !existsSync(join(rt.cwd, target)))
          problems.push(`${page}: ${href} (no such file)`);
        else if (anchor && target.endsWith(".md") && !anchorsOf(target).has(anchor.toLowerCase()))
          problems.push(`${page}: ${href} (no such heading)`);
      }
    }
    return problems;
  },
});

/** Link targets in the text, outside code. */
function links(text: string): string[] {
  const plain = prose(text)
    .replace(/`[^`\n]*`/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  return [...plain.matchAll(/\]\(\s*<?([^)\s>]+)>?/g)].map((m) => m[1] ?? "");
}

/** The anchors GitHub gives a page: one per heading, plus explicit `<a id>` and `<a name>`. */
function anchors(text: string): Set<string> {
  const body = prose(splitFrontmatter(text)?.body ?? text);
  const set = new Set<string>();
  const count = new Map<string, number>();
  for (const m of body.matchAll(/^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm)) {
    const slug = (m[1] ?? "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const n = count.get(slug) ?? 0;
    count.set(slug, n + 1);
    set.add(n ? `${slug}-${n}` : slug);
  }
  for (const m of body.matchAll(/<a\s[^>]*(?:id|name)="([^"]+)"/g))
    set.add((m[1] ?? "").toLowerCase());
  return set;
}

/** The text with fenced code blocks removed. */
function prose(text: string): string {
  let fence = "";
  return text
    .split("\n")
    .filter((line) => {
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (m?.[1] && (!fence || (m[1][0] === fence[0] && m[1].length >= fence.length))) {
        fence = fence ? "" : m[1];
        return false;
      }
      return !fence;
    })
    .join("\n");
}

function decode(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}
