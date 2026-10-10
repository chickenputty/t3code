// Fork (chickenputty/t3code): Windows paths as agents wrote them in real chats.
import { describe, expect, it } from "vite-plus/test";
import remarkParse from "remark-parse";
import { unified } from "unified";

import {
  inlineCodeFilePathCandidate,
  protectFilePathsInMarkdown,
  resolveMarkdownFileLinkTarget,
} from "./markdownLinks.ts";
import { CHAT_MARKDOWN_REMARK_PLUGINS } from "./markdownPipeline.ts";

type MdNode = { type: string; url?: string; value?: string; children?: MdNode[] };

/** Every link and image in the rendered message, as `[type, url, text]`. */
function links(markdown: string): Array<[string, string, string]> {
  const processor = unified().use(remarkParse).use(CHAT_MARKDOWN_REMARK_PLUGINS);
  const tree = processor.runSync(processor.parse(protectFilePathsInMarkdown(markdown))) as MdNode;
  const found: Array<[string, string, string]> = [];
  const text = (node: MdNode): string =>
    node.value ?? (node.children ?? []).map((child) => text(child)).join("");
  const visit = (node: MdNode) => {
    if ((node.type === "link" || node.type === "image" || node.type === "definition") && node.url) {
      found.push([node.type, node.url, text(node) || ((node as { alt?: string }).alt ?? "")]);
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  return found;
}

const VAULT = String.raw`C:\Users\Adam\Workspaces\BIGGamesLLC\Pet Vault`;

describe("protectFilePathsInMarkdown", () => {
  it("renders an image whose path holds a space and a dot folder", () => {
    expect(
      links(
        String.raw`![leak teaser](${VAULT}\.claude\skills\ps99-art\recipes\leak-teaser\proposal\compare.png)`,
      ),
    ).toEqual([
      [
        "image",
        "C:/Users/Adam/Workspaces/BIGGamesLLC/Pet Vault/.claude/skills/ps99-art/recipes/leak-teaser/proposal/compare.png",
        "leak teaser",
      ],
    ]);
  });

  it("keeps a link title and parentheses inside the path", () => {
    expect(links(String.raw`[x](C:\Program Files (x86)\My App\a.md "notes")`)).toEqual([
      ["link", "file:///C:/Program Files (x86)/My App/a.md", "x"],
    ]);
  });

  it("links a prose path and keeps its backslashes", () => {
    expect(
      links(
        String.raw`Saved in ${VAULT}\_coordination\image-gen\output\2026-09\0930-2138 for review.`,
      ),
    ).toEqual([
      [
        "link",
        "file:///C:/Users/Adam/Workspaces/BIGGamesLLC/Pet Vault/_coordination/image-gen/output/2026-09/0930-2138",
        String.raw`${VAULT}\_coordination\image-gen\output\2026-09\0930-2138`,
      ],
    ]);
  });

  it("runs a prose path across folder names with spaces", () => {
    expect(
      links(
        String.raw`Template: C:\Users\Adam\BIG Games Dropbox\Game Assets\Pet Simulator 99 Files\Icons\_Thumbnail_Template.psd, then export.`,
      )[0]?.[1],
    ).toBe(
      "file:///C:/Users/Adam/BIG Games Dropbox/Game Assets/Pet Simulator 99 Files/Icons/_Thumbnail_Template.psd",
    );
  });

  it("ends a prose path at a capitalized folder at the end of a sentence", () => {
    expect(links(String.raw`It lives in ${VAULT}.`)[0]?.[1]).toBe(
      "file:///C:/Users/Adam/Workspaces/BIGGamesLLC/Pet Vault",
    );
    expect(links(String.raw`Copied to C:\Temp and done.`)[0]?.[1]).toBe("file:///C:/Temp");
  });

  it("does not run into the next path or assignment", () => {
    expect(
      links(String.raw`A=C:/Users/Adam/ps99-version-archive H=C:/Users/Adam/big-pet-simulator`).map(
        (link) => link[1],
      ),
    ).toEqual([
      "file:///C:/Users/Adam/ps99-version-archive",
      "file:///C:/Users/Adam/big-pet-simulator",
    ]);
  });

  it("stops at a file name and trailing punctuation", () => {
    expect(links(String.raw`Open C:\a\b.md and C:\c\d.png).`).map((link) => link[1])).toEqual([
      "file:///C:/a/b.md",
      "file:///C:/c/d.png",
    ]);
  });

  it("reads doubled backslashes as single separators", () => {
    expect(links(String.raw`See C:\\Users\\Adam\\x.md now`)[0]?.slice(1)).toEqual([
      "file:///C:/Users/Adam/x.md",
      String.raw`C:\Users\Adam\x.md`,
    ]);
  });

  it("leaves code, link labels, URLs and non-paths alone", () => {
    const untouched = [
      "```\nC:\\a b\\c.png\n```",
      "~~~ps1\n![x](C:\\a b\\c.png)\n~~~",
      "`C:\\a\\b.md` and ``C:\\x\\y.md``",
      "[C:\\a\\b.md](https://example.com)",
      "rbxassetid://15303759254 and https://example.com/C:/x",
      "    C:\\indented\\code.md",
      "no paths here",
    ];
    for (const markdown of untouched) expect(protectFilePathsInMarkdown(markdown)).toBe(markdown);
  });

  it("keeps reference definitions working, spaced or not", () => {
    expect(
      links(String.raw`[a][one] and [b][two]

[one]: C:\Users\me\.work\defined.ts
[two]: C:\Users\me\Pet Vault\notes.md "Notes"`).map((link) => link[1]),
    ).toEqual(["file:///C:/Users/me/.work/defined.ts", "file:///C:/Users/me/Pet Vault/notes.md"]);
  });

  it("is idempotent", () => {
    const once = protectFilePathsInMarkdown(
      String.raw`![a](C:\x y\z.png) and C:\p\q.md and [b](<C:\m n\o.md>)`,
    );
    expect(protectFilePathsInMarkdown(once)).toBe(once);
  });
});

describe("inlineCodeFilePathCandidate on Windows", () => {
  it("accepts a Windows path with spaces", () => {
    expect(inlineCodeFilePathCandidate(String.raw`${VAULT}\core\retrain-verdicts.md`)).toBe(
      String.raw`${VAULT}\core\retrain-verdicts.md`,
    );
    expect(inlineCodeFilePathCandidate(String.raw`"C:\Program Files\Git\bin\bash.exe"`)).toBe(
      String.raw`C:\Program Files\Git\bin\bash.exe`,
    );
  });

  it("rejects commands, placeholders and ellipses", () => {
    for (const code of [
      String.raw`C:\tools\run.exe --flag`,
      String.raw`C:\tools\run.exe /quiet`,
      String.raw`C:\Users\Adam\...\pets\ `,
      String.raw`C:\archive\<dir>\ `,
      "~/.claude/projects/<repo>/<session>.jsonl",
      "origin/main...dd4e90d",
      "scripts/**/*.test.ts",
    ]) {
      expect(inlineCodeFilePathCandidate(code)).toBeNull();
    }
  });
});

describe("Git Bash drive paths", () => {
  it("resolves /c/Users to the Windows drive on a Windows workspace", () => {
    expect(resolveMarkdownFileLinkTarget("/c/Users/Adam/notes.md", "C:\\repo")).toBe(
      "C:/Users/Adam/notes.md",
    );
  });

  it("leaves them as POSIX paths elsewhere", () => {
    expect(resolveMarkdownFileLinkTarget("/c/Users/Adam/notes.md", "/home/me/repo")).toBe(
      "/c/Users/Adam/notes.md",
    );
  });
});
