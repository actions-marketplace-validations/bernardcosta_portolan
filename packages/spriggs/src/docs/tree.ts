import { join } from "node:path";
import { git } from "../git";
import { splitFrontmatter } from "./frontmatter";

export type DocInfo = { path: string; summary: string; agent: boolean; covers: string[] };

/** Every tracked markdown doc under docs/, except change entries, with its frontmatter. */
export async function docsIndex(cwd = process.cwd()): Promise<DocInfo[]> {
  const paths = git(["ls-files", "docs"], cwd)
    .trim()
    .split("\n")
    .filter((p) => p.endsWith(".md") && !p.startsWith("docs/changes/"));
  const docs: DocInfo[] = [];
  for (const path of paths) {
    let text: string;
    try {
      text = await Bun.file(join(cwd, path)).text();
    } catch {
      continue; // a dangling symlink or a file git lists but the checkout lacks
    }
    const fm = splitFrontmatter(text);
    const covers = Array.isArray(fm?.data.covers) ? fm.data.covers.map(String) : [];
    docs.push({
      path,
      summary: typeof fm?.data.summary === "string" ? fm.data.summary : "",
      agent: fm?.data.audience === "agent",
      covers,
    });
  }
  return docs;
}

/** Docs whose `covers` paths are a prefix of a changed file. No model call. */
export function affectedDocs(index: DocInfo[], changedPaths: string[]): DocInfo[] {
  return index.filter((doc) =>
    doc.covers.some((cover) => {
      const prefix = cover.replace(/\/?\*+$/, "").replace(/\/$/, "");
      return changedPaths.some((p) => p === prefix || p.startsWith(`${prefix}/`));
    }),
  );
}
