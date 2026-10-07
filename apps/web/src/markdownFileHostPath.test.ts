import { describe, expect, it } from "vite-plus/test";

import { resolveMarkdownFileLinkMeta } from "./markdown-links";
import { markdownFileEditorTarget, resolveMarkdownFileHostPath } from "./markdownFileHostPath";

const CWD = "C:\\Users\\me\\repo";

// A markdown link such as [thumb.png](thumb.png), as the agent writes it.
function chipMeta(href: string) {
  const meta = resolveMarkdownFileLinkMeta(href, CWD);
  if (meta === null) throw new Error(`not a file chip: ${href}`);
  return meta;
}

describe("resolveMarkdownFileHostPath", () => {
  it("finds a bare filename in a subfolder for preview, open and copy", async () => {
    const meta = chipMeta("blood_moon_thumb_one.png");
    const queries: string[] = [];
    const hostPath = await resolveMarkdownFileHostPath({
      meta,
      cwd: CWD,
      findWorkspaceMatch: async (relativePath) => {
        queries.push(relativePath);
        return "tools/promo/out/blood_moon_thumb_one.png";
      },
    });

    expect(queries).toEqual(["blood_moon_thumb_one.png"]);
    expect(hostPath).toEqual({
      absolutePath: "C:\\Users\\me\\repo\\tools\\promo\\out\\blood_moon_thumb_one.png",
      relativePath: "tools/promo/out/blood_moon_thumb_one.png",
      matched: true,
    });
    expect(markdownFileEditorTarget(meta, hostPath)).toBe(hostPath.absolutePath);
  });

  it("keeps the line and column when the editor opens a matched file", async () => {
    const meta = chipMeta("ChatView.tsx:42:7");
    const hostPath = await resolveMarkdownFileHostPath({
      meta,
      cwd: CWD,
      findWorkspaceMatch: async () => "apps/web/src/ChatView.tsx",
    });

    expect(markdownFileEditorTarget(meta, hostPath)).toBe(
      "C:\\Users\\me\\repo\\apps\\web\\src\\ChatView.tsx:42:7",
    );
  });

  it("keeps the link's own path when the index has no match", async () => {
    const meta = chipMeta("missing.png");
    const hostPath = await resolveMarkdownFileHostPath({
      meta,
      cwd: CWD,
      findWorkspaceMatch: async () => null,
    });

    expect(hostPath).toEqual({
      absolutePath: meta.filePath,
      relativePath: "missing.png",
      matched: false,
    });
    expect(markdownFileEditorTarget(meta, hostPath)).toBe(meta.targetPath);
  });
});
