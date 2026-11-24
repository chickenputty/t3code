import type { mediaKindFromPath } from "./mediaPreview.ts";
import {
  isNetworkPath,
  isUncPath,
  isWindowsAbsolutePath,
  stripSlashPrefixedWindowsDrive,
  workspaceRelativeFilePath,
} from "./path.ts";
import {
  type FilePathPosition,
  formatFilePathPosition,
  parseFileUrlHref,
  resolvePathLinkTarget,
  splitFilePathPosition,
} from "./fileLinks.ts";

const RELATIVE_PATH_PREFIX_PATTERN = /^(~\/|\.{1,2}\/)/;

// Names may use any script (`線性代數/考試.pdf`) and routing punctuation (`posts.$id.tsx`,
// `(group)/[id]/+page.svelte`, `@scope/pkg`). The final segment is optional so an explicit
// folder link may end in `/` (`patches/`, `docs/My Folder/`). A bare name with no slash still fails.
const RELATIVE_FILE_PATH_PATTERN =
  /^(?:[\p{L}\p{M}\p{N}._$+@()[\]-]+(?: +[\p{L}\p{M}\p{N}._$+@()[\]-]+)*\/)+(?:[\p{L}\p{M}\p{N}._$+@()[\]-]+(?: +[\p{L}\p{M}\p{N}._$+@()[\]-]+)*(?::\d+(?::\d+|-\d+)?)?)?$/u;

// No `@` here: `me@example.com` is an address, not a file.
const RELATIVE_FILE_NAME_PATTERN =
  /^[\p{L}\p{M}\p{N}._$+()[\]-]+(?: +[\p{L}\p{M}\p{N}._$+()[\]-]+)*\.[\p{L}\p{M}\p{N}_-]+(?::\d+(?::\d+|-\d+)?)?$/u;

const EXTERNAL_SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/;

const POSITION_SUFFIX_PATTERN = /:\d+(?::\d+|-\d+)?$/;

const POSITION_ONLY_PATTERN = /^\d+(?::\d+|-\d+)?$/;

const INLINE_CODE_WHITESPACE_PATTERN = /\s/;

// Inline code with spaces is a file only when it is absolute and every word is a plain name:
// `/Users/me/Mobile Documents/a - b.md` is, `/usr/bin/python3 -m venv .venv` (a flag) is not.
// A space only in the last segment reads as a command (`/usr/local/bin/node server.js`), so it
// must sit under a user root, and nothing after a bin folder counts.
const SPACED_ABSOLUTE_PATH_ROOT_PATTERN = /^(?:\/|~\/|[A-Za-z]:[\\/])/;
const SPACED_PATH_BODY_PATTERN =
  /^(?:[\p{L}\p{M}\p{N}._$+@()[\]-]+(?: (?!-+\p{L})[\p{L}\p{M}\p{N}._$+@()[\]-]+)*(?:[\\/]|$))+$/u;

function isSpacedAbsoluteFilePath(text: string): boolean {
  const root = SPACED_ABSOLUTE_PATH_ROOT_PATTERN.exec(text)?.[0];
  if (root === undefined) return false;
  const body = text.slice(root.length).replace(POSITION_SUFFIX_PATTERN, "");
  if (!SPACED_PATH_BODY_PATTERN.test(body)) return false;
  const firstSpace = body.indexOf(" ");
  const foldersBeforeSpace = body.slice(0, firstSpace).split(PATH_SEPARATOR_PATTERN).slice(0, -1);
  if (foldersBeforeSpace.some((folder) => folder === "bin" || folder === "sbin")) return false;
  const spaceInFolder = PATH_SEPARATOR_PATTERN.test(body.slice(firstSpace));
  if (!spaceInFolder && root === "/" && !/^(?:Users|home)[\\/]/.test(body)) return false;
  if (PATH_SEPARATOR_PATTERN.test(body.at(-1) ?? "")) return true;
  const basename = body.split(PATH_SEPARATOR_PATTERN).at(-1) ?? "";
  return FILE_EXTENSION_PATTERN.test(basename) || EXTENSIONLESS_FILE_NAMES.has(basename);
}

const INLINE_CODE_PLACEHOLDER_PATTERN = /[<>*?{}|]|\.\.\.|…/;

// Fork: Git Bash writes `C:\Users` as `/c/Users`.
const MSYS_DRIVE_PATH_PATTERN =
  /^\/([A-Za-z])\/(?=(?:Users|ProgramData|Program Files|Windows)\/|.*\.[A-Za-z0-9_-]+(?::\d+){0,2}$)/;

const PATH_SEPARATOR_PATTERN = /[\\/]/;
// Agents shorten long paths with a `...` or `…` segment, which no file chip can open.
const ELIDED_PATH_SEGMENT_PATTERN = /(?:^|[\\/])(?:\.{3,}|…)(?:[\\/]|$)/;

const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9_-]+$/;
const ANY_FILE_EXTENSION_PATTERN = /\.[^./\\]+$/;
const VERSION_SUFFIX_PATTERN = /\d\.\d[^.]*$/;
const NUMERIC_DOTTED_PATTERN = /^\d+(?:\.\d+)+$/;

const POSIX_FILE_ROOT_PREFIXES = [
  "/Users/",
  "/home/",
  "/tmp/",
  "/var/",
  "/etc/",
  "/opt/",
  "/mnt/",
  "/Volumes/",
  "/private/",
  "/root/",
  "/usr/",
  "/bin/",
  "/sbin/",
  "/lib/",
  "/lib64/",
  "/srv/",
  "/dev/",
  "/proc/",
  "/sys/",
  "/run/",
  "/boot/",
  "/media/",
  "/workspace/",
  "/workspaces/",
] as const;

export const EXTENSIONLESS_FILE_NAMES: ReadonlySet<string> = new Set([
  "Makefile",
  "makefile",
  "GNUmakefile",
  "Dockerfile",
  "Containerfile",
  "Justfile",
  "justfile",
  "Rakefile",
  "Gemfile",
  "Procfile",
  "Brewfile",
  "Caddyfile",
  "Vagrantfile",
  "Jenkinsfile",
  "Podfile",
  "Fastfile",
  "BUILD",
  "WORKSPACE",
  "LICENSE",
  "LICENCE",
  "COPYING",
  "NOTICE",
  "AUTHORS",
  "CONTRIBUTORS",
  "CHANGELOG",
  "README",
  "CODEOWNERS",
]);

const SINGLE_LABEL_HOSTNAMES = new Set(["localhost"]);

const GENERIC_HOSTNAME_TLDS = new Set([
  "com",
  "net",
  "org",
  "io",
  "dev",
  "app",
  "ai",
  "co",
  "edu",
  "gov",
  "mil",
  "info",
  "biz",
  "xyz",
  "me",
  "tv",
  "gg",
  "chat",
  "cloud",
  "site",
  "online",
  "tech",
  "store",
  "link",
]);

const COUNTRY_HOSTNAME_TLDS = new Set([
  "uk",
  "de",
  "fr",
  "nl",
  "se",
  "no",
  "fi",
  "dk",
  "pl",
  "ch",
  "at",
  "be",
  "es",
  "it",
  "pt",
  "eu",
  "us",
  "ca",
  "au",
  "nz",
  "jp",
  "kr",
  "cn",
  "br",
  "ru",
  "mx",
  "ie",
  "cz",
  "tr",
  "sg",
  "hk",
  // C++ sources end in `.cc`, so `allocator.cc:217` names a file, not a host and port.
  "cc",
]);

function looksLikeHostname(segment: string, hasPosition: boolean): boolean {
  if (segment.startsWith(".")) return false;
  const lowered = segment.toLowerCase();
  if (SINGLE_LABEL_HOSTNAMES.has(lowered)) return true;
  if (NUMERIC_DOTTED_PATTERN.test(segment)) return true;
  const labels = lowered.split(".");
  const lastLabel = labels.at(-1);
  if (labels.length < 2 || lastLabel === undefined) return false;
  if (GENERIC_HOSTNAME_TLDS.has(lastLabel)) return true;
  return !hasPosition && COUNTRY_HOSTNAME_TLDS.has(lastLabel);
}

export function inlineCodeFilePathCandidate(codeText: string): string | null {
  const code = codeText.trim();
  // Fork: `<dir>`, `*.ts`, `{a,b}` and `...` describe a path rather than name one.
  if (INLINE_CODE_PLACEHOLDER_PATTERN.test(code)) return null;
  // Fork: a quoted Windows path (`"C:\Program Files\x.exe"`) names the path inside the quotes.
  const unquoted = /^"[^"]+"$/.test(code) ? code.slice(1, -1) : code;
  const trimmed = isWindowsAbsolutePath(unquoted) ? unquoted : code;
  if (trimmed.length === 0 || trimmed.includes("`")) return null;
  if (INLINE_CODE_WHITESPACE_PATTERN.test(trimmed) && !isSpacedAbsoluteFilePath(trimmed)) {
    return null;
  }

  const candidate = isWindowsAbsolutePath(trimmed) ? trimmed : trimmed.replaceAll("\\", "/");
  const hasPosition = POSITION_SUFFIX_PATTERN.test(candidate);
  if (!hasPosition && !PATH_SEPARATOR_PATTERN.test(candidate)) return null;
  if (ELIDED_PATH_SEGMENT_PATTERN.test(candidate.replace(POSITION_SUFFIX_PATTERN, ""))) return null;

  const hasExplicitPathShape =
    RELATIVE_PATH_PREFIX_PATTERN.test(candidate) ||
    candidate.startsWith("/") ||
    isWindowsAbsolutePath(candidate);
  if (!hasExplicitPathShape) {
    const withoutPosition = candidate.replace(POSITION_SUFFIX_PATTERN, "");
    // Markdown destinations accept `patches/`. Inline code still needs a
    // file-shaped final segment, so a trailing slash stays plain code.
    if (withoutPosition.endsWith("/")) return null;
    const firstSegment = withoutPosition.split("/")[0] ?? withoutPosition;
    if (looksLikeHostname(firstSegment, hasPosition)) return null;
    const basename =
      withoutPosition
        .replace(/[/\\]+$/, "")
        .split(/[\\/]/)
        .at(-1) ?? "";
    if (VERSION_SUFFIX_PATTERN.test(basename)) return null;
    if (!FILE_EXTENSION_PATTERN.test(basename)) {
      if (!hasPosition) return EXTENSIONLESS_FILE_NAMES.has(basename) ? candidate : null;
      // A `:line` suffix alone does not make `I/W217:220` a file reference.
      if (
        withoutPosition.includes("/") &&
        !ANY_FILE_EXTENSION_PATTERN.test(basename) &&
        !EXTENSIONLESS_FILE_NAMES.has(basename)
      ) {
        return null;
      }
    }
  }
  return candidate;
}

export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeMarkdownLinkDestination(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed;
}

export function splitMarkdownLinkSearchAndHash(value: string): {
  readonly path: string;
  readonly hash: string;
} {
  const hashIndex = value.indexOf("#");
  const pathWithSearch = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
  const queryIndex = pathWithSearch.indexOf("?");
  return {
    path: queryIndex >= 0 ? pathWithSearch.slice(0, queryIndex) : pathWithSearch,
    hash,
  };
}

/**
 * The decoded path a markdown destination names on the host, before any workspace resolution, or
 * null for a `file:` URL that does not parse. Clients and the guest media route both read it here.
 */
export function markdownDestinationHostPath(source: string): string | null {
  if (/^file:/i.test(source)) {
    const target = parseFileUrlHref(source);
    return target === null
      ? null
      : stripSlashPrefixedWindowsDrive(safeDecodeURIComponent(target.path));
  }
  return stripSlashPrefixedWindowsDrive(
    safeDecodeURIComponent(splitMarkdownLinkSearchAndHash(source).path),
  );
}

const DIRECT_IMAGE_SOURCE_PATTERN = /^(?:https?:|data:|blob:|\/\/)/i;
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export type MarkdownImageSource =
  | { readonly _tag: "Direct"; readonly uri: string }
  | { readonly _tag: "WorkspaceFile"; readonly path: string; readonly relative?: true }
  | { readonly _tag: "Blocked" };

function joinWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const separator = isWindowsAbsolutePath(workspaceRoot) ? "\\" : "/";
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  const path = relativePath.replace(/[\\/]/g, separator).replace(/^[\\/]+/, "");
  return `${root}${separator}${path}`;
}

/** Rendering is not a click, so a network path loads only from the project's own share. */
function hostFileSource(
  path: string,
  workspaceRoot: string | null | undefined,
): MarkdownImageSource {
  return isNetworkPath(path) && workspaceRelativeFilePath(path, workspaceRoot) === null
    ? { _tag: "Blocked" }
    : { _tag: "WorkspaceFile", path };
}

/**
 * Filesystem paths belong to the environment host and must never reach a
 * browser or native image component without first becoming a signed asset URL.
 */
export function classifyMarkdownImageSource(
  value: string | null | undefined,
  workspaceRoot?: string | null,
): MarkdownImageSource {
  if (value === null || value === undefined) return { _tag: "Blocked" };

  const source = normalizeMarkdownLinkDestination(value);
  if (source.length === 0 || source.startsWith("#") || source.startsWith("?")) {
    return { _tag: "Blocked" };
  }
  if (DIRECT_IMAGE_SOURCE_PATTERN.test(source)) {
    return { _tag: "Direct", uri: source };
  }

  const path = markdownDestinationHostPath(source);
  if (path === null) return { _tag: "Blocked" };
  if (/^file:/i.test(source)) return hostFileSource(path, workspaceRoot);
  if (path.length === 0) return { _tag: "Blocked" };
  if (path.startsWith("/") || isWindowsAbsolutePath(path)) {
    return hostFileSource(path, workspaceRoot);
  }
  if (URI_SCHEME_PATTERN.test(path) || path.startsWith("~/") || path.startsWith("~\\")) {
    return { _tag: "Blocked" };
  }
  if (!workspaceRoot) return { _tag: "Blocked" };

  return { _tag: "WorkspaceFile", path: joinWorkspacePath(workspaceRoot, path), relative: true };
}

export function shouldRenderMarkdownImageAsFileLink(
  source: MarkdownImageSource,
  mediaKind: ReturnType<typeof mediaKindFromPath>,
): boolean {
  return source._tag === "WorkspaceFile" && mediaKind === null;
}

export function isMarkdownFileLinkLabel(label: string, href: string): boolean {
  const destination = parseMarkdownFileLink(href);
  if (!destination) return false;
  const normalize = (path: string) =>
    path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const labelPosition = splitFilePathPosition(label.trim());
  if (
    (labelPosition.line !== undefined && labelPosition.line !== destination.line) ||
    (labelPosition.column !== undefined && labelPosition.column !== destination.column) ||
    (labelPosition.endLine !== undefined && labelPosition.endLine !== destination.endLine)
  ) {
    return false;
  }
  let labelPath = normalize(labelPosition.path);
  let destinationPath = normalize(destination.path);
  if (labelPath.length === 0) return true;
  if (isWindowsAbsolutePath(destination.path)) {
    labelPath = labelPath.toLowerCase();
    destinationPath = destinationPath.toLowerCase();
  }
  return destinationPath === labelPath || destinationPath.endsWith(`/${labelPath}`);
}

export function isRelativeFilePath(path: string): boolean {
  return (
    RELATIVE_PATH_PREFIX_PATTERN.test(path) ||
    (!path.startsWith("/") && !isWindowsAbsolutePath(path))
  );
}

function looksLikePosixFilesystemPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (POSIX_FILE_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (MSYS_DRIVE_PATH_PATTERN.test(path)) return true;
  if (POSITION_SUFFIX_PATTERN.test(path)) return true;
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return EXTENSIONLESS_FILE_NAMES.has(basename) || FILE_EXTENSION_PATTERN.test(basename);
}

function looksLikeFilePath(path: string, authoredPath: string): boolean {
  if (isWindowsAbsolutePath(path) || RELATIVE_PATH_PREFIX_PATTERN.test(path)) return true;
  if (path.startsWith("/")) return looksLikePosixFilesystemPath(authoredPath);
  if (EXTENSIONLESS_FILE_NAMES.has(path)) return true;
  return RELATIVE_FILE_PATH_PATTERN.test(authoredPath) || RELATIVE_FILE_NAME_PATTERN.test(path);
}

function hasExternalScheme(path: string): boolean {
  if (isWindowsAbsolutePath(path)) return false;
  const match = path.match(EXTERNAL_SCHEME_PATTERN);
  if (!match) return false;
  const rest = match[2] ?? "";
  if (rest.startsWith("//")) return true;
  return !POSITION_ONLY_PATTERN.test(rest);
}

export function parseMarkdownFileLink(href: string): FilePathPosition | null {
  const normalized = normalizeMarkdownLinkDestination(href);
  if (normalized.length === 0 || normalized.startsWith("#") || normalized.startsWith("//")) {
    return null;
  }

  const source =
    (normalized.toLowerCase().startsWith("file:") ? parseFileUrlHref(normalized) : null) ??
    splitMarkdownLinkSearchAndHash(normalized);
  const path = stripSlashPrefixedWindowsDrive(safeDecodeURIComponent(source.path.trim()));
  const hash = safeDecodeURIComponent(source.hash.trim());
  if (path.length === 0 || hasExternalScheme(path)) return null;

  const position = parseFilePathLink(path, hash);
  // `src\a.ts` is Windows-relative. A link that already parses keeps its spelling, since POSIX
  // names may contain `\`; a rooted `\\host` or `\foo` would change root if rewritten.
  if (position || /^[\\/]/.test(path) || isWindowsAbsolutePath(path)) return position;
  return path.includes("\\") ? parseFilePathLink(path.replaceAll("\\", "/"), hash) : null;
}

function parseFilePathLink(path: string, hash: string): FilePathPosition | null {
  const position = splitFilePathPosition(path, hash);
  return !ELIDED_PATH_SEGMENT_PATTERN.test(position.path) && looksLikeFilePath(position.path, path)
    ? position
    : null;
}

const FENCED_CODE_SEGMENT_PATTERN = /(```[\s\S]*?(?:```|$))/;

const INLINE_CODE_SPAN_PATTERN = /`([^`\n]+)`/g;

export function extractInlineCodeSpans(text: string): string[] {
  const spans: string[] = [];
  const segments = text.split(FENCED_CODE_SEGMENT_PATTERN);
  for (let index = 0; index < segments.length; index += 2) {
    for (const match of (segments[index] ?? "").matchAll(INLINE_CODE_SPAN_PATTERN)) {
      const span = match[1]?.trim();
      if (span) spans.push(span);
    }
  }
  return spans;
}

function markdownRunEndFinder(markdown: string, delimiter: RegExp) {
  let runStart = -1;
  let runEnd = -1;
  return (start: number) => {
    if (start >= runStart && start <= runEnd) return runEnd;
    delimiter.lastIndex = start;
    runStart = start;
    runEnd = delimiter.exec(markdown)?.index ?? markdown.length;
    return runEnd;
  };
}

function markdownLinkTailScanner(markdown: string) {
  // A blank line ends the paragraph, so no part of a link's tail runs past one.
  const whitespaceEnd = markdownRunEndFinder(markdown, /\S|\n[ \t\r]*\n/g);
  const doubleQuoteEnd = markdownRunEndFinder(markdown, /"|\n[ \t\r]*\n/g);
  const singleQuoteEnd = markdownRunEndFinder(markdown, /'|\n[ \t\r]*\n/g);
  const titleWhitespaceEnd = markdownRunEndFinder(markdown, /\S|\n[ \t\r]*\n/g);
  return (start: number) => {
    const end = whitespaceEnd(start);
    const quote = markdown[end];
    if (quote === ")") return end + 1;
    if (end === start || (quote !== '"' && quote !== "'")) return null;
    const quoteEnd = (quote === '"' ? doubleQuoteEnd : singleQuoteEnd)(end + 1);
    if (markdown[quoteEnd] !== quote) return null;
    const close = titleWhitespaceEnd(quoteEnd + 1);
    return markdown[close] === ")" ? close + 1 : null;
  };
}

// micromark's own nesting limit. It also keeps link scanning linear: a scan only runs past another
// link's opening parenthesis while that parenthesis counts toward this depth.
const MAX_BARE_DESTINATION_PAREN_DEPTH = 32;

function bareMarkdownLinkDestinationEnd(markdown: string, start: number): number | null {
  const delimiter = /[\s()\\]/g;
  delimiter.lastIndex = start;
  let depth = 0;
  while (true) {
    const index = delimiter.exec(markdown)?.index ?? markdown.length;
    const char = markdown[index];
    if (char === "\\") {
      if (/[()\\]/.test(markdown[index + 1] ?? "")) delimiter.lastIndex = index + 2;
    } else if (char === "(") {
      if (depth === MAX_BARE_DESTINATION_PAREN_DEPTH) return null;
      depth += 1;
    } else if (char === ")" && depth > 0) {
      depth -= 1;
    } else {
      return depth === 0 ? index : null;
    }
  }
}

function markdownLinkDestinationScanner(markdown: string) {
  const whitespaceEnd = markdownRunEndFinder(markdown, /\S/g);
  const angleEnd = markdownRunEndFinder(markdown, /[>\n]/g);
  // Separate caches keep scans moving forward when angle destinations fall back to bare ones.
  const angleTail = markdownLinkTailScanner(markdown);
  const bareTail = markdownLinkTailScanner(markdown);
  return (start: number) => {
    if (markdown[start] !== "(") return null;
    const hrefStart = whitespaceEnd(start + 1);
    if (markdown[hrefStart] === "<") {
      const hrefEnd = angleEnd(hrefStart + 1);
      if (hrefEnd > hrefStart + 1 && markdown[hrefEnd] === ">") {
        const end = angleTail(hrefEnd + 1);
        if (end !== null) return { hrefStart: hrefStart + 1, hrefEnd, end };
      }
    }
    const hrefEnd = bareMarkdownLinkDestinationEnd(markdown, hrefStart);
    if (hrefEnd === null) return null;
    const end = bareTail(hrefEnd);
    return end === null ? null : { hrefStart, hrefEnd, end };
  };
}

// Labels may nest balanced brackets (`[the [docs] guide](...)`), and the composer escapes them
// (`[\[id\].tsx](...)`), so `\[` and `\]` never count. A blank line ends the paragraph and its labels.
export function extractMarkdownLinkHrefs(markdown: string): string[] {
  const hrefs: string[] = [];
  const scanDestination = markdownLinkDestinationScanner(markdown);
  const bracket = /[[\]\\]|\n[ \t\r]*\n/g;
  let openBrackets = 0;
  for (let match = bracket.exec(markdown); match; match = bracket.exec(markdown)) {
    if (match[0] === "\\") {
      bracket.lastIndex = match.index + 2;
    } else if (match[0].startsWith("\n")) {
      openBrackets = 0;
    } else if (match[0] === "[") {
      openBrackets += 1;
    } else if (openBrackets > 0) {
      openBrackets -= 1;
      const destination = scanDestination(match.index + 1);
      if (!destination) continue;
      // A link cannot contain a link, so the brackets still open around it become text.
      openBrackets = 0;
      bracket.lastIndex = destination.end;
      const href = markdown.slice(destination.hrefStart, destination.hrefEnd).trim();
      if (href) hrefs.push(href);
    }
  }
  return hrefs;
}

export function resolveMarkdownFileLinkTarget(
  href: string | undefined,
  cwd?: string,
  baseDir: string | undefined = cwd,
): string | null {
  return resolveMarkdownFileLink(href, cwd, baseDir)?.targetPath ?? null;
}

/** Resolves the displayed position and the editor target, which opens at the start line. */
export function resolveMarkdownFileLink(
  href: string | undefined,
  cwd?: string,
  baseDir: string | undefined = cwd,
): { sourcePath: string; targetPath: string; position: FilePathPosition } | null {
  const source = href ? parseMarkdownFileLink(href) : null;
  if (!source) return null;

  const targetPath = resolveParsedFileLinkTarget(source, cwd, baseDir);
  if (!targetPath) return null;
  return {
    sourcePath: source.path,
    targetPath,
    position: {
      ...splitFilePathPosition(targetPath),
      ...(source.endLine !== undefined ? { endLine: source.endLine } : {}),
    },
  };
}

function resolveParsedFileLinkTarget(
  target: FilePathPosition,
  cwd: string | undefined,
  baseDir: string | undefined,
): string | null {
  const pathWithPosition = formatFilePathPosition(target);
  const msysDrive = MSYS_DRIVE_PATH_PATTERN.exec(pathWithPosition)?.[1];
  if (msysDrive && (cwd ?? baseDir) && isWindowsAbsolutePath(cwd ?? baseDir ?? "")) {
    return `${msysDrive.toUpperCase()}:/${pathWithPosition.slice(3)}`;
  }
  if (!isRelativeFilePath(pathWithPosition)) {
    // Opening a network path makes Windows sign in to its host with the user's
    // NTLM credentials, so only the project's own share becomes a file link.
    return isNetworkPath(target.path) && workspaceRelativeFilePath(target.path, cwd) === null
      ? null
      : pathWithPosition;
  }
  if (!baseDir) return null;
  return resolvePathLinkTarget(pathWithPosition, baseDir);
}

export function isWindowsDrivePathHref(href: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(safeDecodeURIComponent(href));
}

// CommonMark ends an unwrapped link destination at a space and reads `\_` in prose as an
// escape, which breaks Windows paths. Before parsing, spaced Windows destinations get angle
// brackets and Windows paths in prose become links whose label keeps every backslash.
// Code is never touched.

const FENCE_LINE_PATTERN = /^[ \t]*(?:>[ \t]?)*[ \t]*(`{3,}|~{3,})/;
const LINK_DEFINITION_LINE_PATTERN = /^( {0,3}\[[^\]\n]+\]:[ \t]*)\S/;
const FENCE_CLOSE_LINE_PATTERN = /^[ \t]*(?:>[ \t]?)*[ \t]*(`{3,}|~{3,})[ \t]*$/;
const PROSE_DRIVE_PATH_START = /[A-Za-z]:(?:\\\\|\\|\/)(?![\\/])/y;
const PROSE_PATH_STOP_CHARS = new Set([" ", "\t", "`", "<", ">", '"', "|", "*", "?"]);
const PROSE_PATH_TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;
const PROSE_PATH_SPACED_WORD = /^[A-Za-z0-9][\w.&'()+-]*$/;
const PROSE_PATH_CAPITALIZED_WORD = /^[A-Z0-9][\w.&'()+-]*$/;
const MAX_SPACED_WORDS = 4;

function windowsPathDestinationStart(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\[^\\/])/.test(value);
}

/** Index of the `)` closing a link destination that starts at `from`, or -1. */
function findDestinationEnd(line: string, from: number): number {
  let depth = 0;
  for (let index = from; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\" && line[index + 1] === ")") {
      index += 1;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

/** Index of the `]` closing a link label opened at `from` (the `[`), or -1. */
function findLabelEnd(line: string, from: number): number {
  let depth = 0;
  for (let index = from; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\") {
      index += 1;
    } else if (char === "`") {
      const run = /^`+/.exec(line.slice(index))?.[0] ?? "`";
      const close = line.indexOf(run, index + run.length);
      if (close < 0) return -1;
      index = close + run.length - 1;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** `dest` or `dest "title"` with a spaced Windows destination wrapped in angle brackets. */
function protectLinkDestination(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("<") || !windowsPathDestinationStart(trimmed)) return content;
  const titled = /^(.*?)\s+("[^"]*"|'[^']*')$/.exec(trimmed);
  const url = (titled?.[1] ?? trimmed).trim();
  if (!/\s/.test(url) || /[<>\n]/.test(url)) return content;
  // Forward slashes survive every markdown parser's escapes; UNC keeps its own.
  const destination = isUncPath(url) ? url : url.replaceAll("\\", "/");
  return titled ? `<${destination}> ${titled[2]}` : `<${destination}>`;
}

function hasFileExtension(segment: string): boolean {
  return FILE_EXTENSION_PATTERN.test(segment) && !VERSION_SUFFIX_PATTERN.test(segment);
}

function lastPathSegment(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? ""
  );
}

function trimUnbalancedClosers(path: string): string {
  let result = path.replace(PROSE_PATH_TRAILING_PUNCTUATION, "");
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
  ] as const) {
    while (result.endsWith(close) && result.split(close).length > result.split(open).length) {
      result = result.slice(0, -1).replace(PROSE_PATH_TRAILING_PUNCTUATION, "");
    }
  }
  return result;
}

/** One unspaced run of path characters starting at `from`. */
function readPathRun(text: string, from: number): string {
  let end = from;
  while (end < text.length && !PROSE_PATH_STOP_CHARS.has(text[end]!)) end += 1;
  return text.slice(from, end);
}

/**
 * Folder names may hold spaces, so a prose path runs on across up to four words when a later
 * word continues it with a separator, or at a sentence end when every word is capitalized
 * (`...\Pet Vault.`). A segment with a file extension ends the path.
 */
function readProsePath(text: string, from: number): string {
  let path = trimUnbalancedClosers(readPathRun(text, from));
  let cursor = from + path.length;
  while (text[cursor] === " " && !hasFileExtension(lastPathSegment(path)) && !/[\\/]$/.test(path)) {
    const words: string[] = [];
    let next = cursor;
    let joined: string | null = null;
    while (words.length < MAX_SPACED_WORDS && text[next] === " ") {
      const run = readPathRun(text, next + 1);
      // A drive or `KEY=value` starts something new; folder names never hold `:`.
      if (run.length === 0 || /[:=]/.test(run)) break;
      const word = trimUnbalancedClosers(run);
      if (/[\\/]/.test(word)) {
        if (!/^[\\/]/.test(word)) joined = `${[...words, word].join(" ")}`;
        break;
      }
      if (word !== run) {
        // Sentence punctuation after the word: the path may end here.
        if ([...words, word].every((entry) => PROSE_PATH_CAPITALIZED_WORD.test(entry))) {
          joined = [...words, word].join(" ");
        }
        break;
      }
      if (!PROSE_PATH_SPACED_WORD.test(word)) break;
      words.push(word);
      next += 1 + run.length;
    }
    if (joined === null) {
      const atEnd = next >= text.length || text[next] !== " ";
      if (
        atEnd &&
        words.length > 0 &&
        words.every((entry) => PROSE_PATH_CAPITALIZED_WORD.test(entry))
      ) {
        joined = words.join(" ");
      }
    }
    if (joined === null) break;
    path = `${path} ${joined}`;
    cursor = from + path.length;
  }
  return path;
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[\\[\]*_`]/g, "\\$&");
}

function protectProse(text: string): string {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\" && index + 1 < text.length) {
      result += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === "<") {
      // `<C:/x.md>` is not an autolink (a scheme needs two letters), so it
      // would show as text; link it like a prose path.
      const bracketed = /^<([A-Za-z]:[\\/][^<>\n]*)>/.exec(text.slice(index))?.[1];
      if (bracketed && !/^\s|\s$/.test(bracketed)) {
        result += `[${escapeMarkdownLabel(bracketed)}](<${bracketed.replaceAll("\\", "/")}>)`;
        index += bracketed.length + 2;
        continue;
      }
      // An autolink or an HTML tag (attributes may quote a path) stays as written.
      const tag = /^<(?:[^\s<>]+>|[A-Za-z/!][^<>"']*(?:(?:"[^"]*"|'[^']*')[^<>"']*)*>)/.exec(
        text.slice(index),
      )?.[0];
      if (tag) {
        result += tag;
        index += tag.length;
        continue;
      }
    }
    if (char === "[" || (char === "!" && text[index + 1] === "[")) {
      const labelStart = char === "!" ? index + 1 : index;
      const labelEnd = findLabelEnd(text, labelStart);
      if (labelEnd >= 0 && text[labelEnd + 1] === "(") {
        const destinationEnd = findDestinationEnd(text, labelEnd + 2);
        if (destinationEnd >= 0) {
          result +=
            text.slice(index, labelEnd + 2) +
            protectLinkDestination(text.slice(labelEnd + 2, destinationEnd)) +
            ")";
          index = destinationEnd + 1;
          continue;
        }
      }
      if (labelEnd >= 0) {
        result += text.slice(index, labelEnd + 1);
        index = labelEnd + 1;
        continue;
      }
    }
    PROSE_DRIVE_PATH_START.lastIndex = index;
    if (
      (index === 0 || /[\s("'*_>=,;]/.test(text[index - 1]!)) &&
      PROSE_DRIVE_PATH_START.test(text)
    ) {
      const path = readProsePath(text, index);
      const destination = path.replace(/\\\\/g, "\\").replaceAll("\\", "/");
      if (/^[A-Za-z]:\/[^/]/.test(destination)) {
        result += `[${escapeMarkdownLabel(path.replace(/\\\\/g, "\\"))}](<${destination}>)`;
        index += path.length;
        continue;
      }
    }
    result += char;
    index += 1;
  }
  return result;
}

/** Applies `protectProse` to a line, leaving inline code spans as written. */
function protectLine(line: string): string {
  let result = "";
  let prose = "";
  let index = 0;
  while (index < line.length) {
    if (line[index] === "\\" && index + 1 < line.length) {
      prose += line.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (line[index] === "`") {
      const run = /^`+/.exec(line.slice(index))![0];
      const close = line.indexOf(run, index + run.length);
      const closesExactly = close >= 0 && line[close + run.length] !== "`";
      if (closesExactly) {
        result += protectProse(prose) + line.slice(index, close + run.length);
        prose = "";
        index = close + run.length;
        continue;
      }
      prose += run;
      index += run.length;
      continue;
    }
    prose += line[index];
    index += 1;
  }
  return result + protectProse(prose);
}

/**
 * Rewrites assistant markdown so Windows file paths survive CommonMark. Run it
 * on chat text only: the result's offsets differ from the source, so markdown
 * files edited in place (task list toggles) must be parsed as written.
 */
export function protectFilePathsInMarkdown(markdown: string): string {
  if (!/[A-Za-z]:[\\/]/.test(markdown)) return markdown;
  const lines = markdown.split("\n");
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (fence !== null) {
      const close = FENCE_CLOSE_LINE_PATTERN.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
      continue;
    }
    const open = FENCE_LINE_PATTERN.exec(line)?.[1];
    if (open) {
      fence = open;
      continue;
    }
    // Four-space indented code outside a list stays as written.
    if (/^(?: {4}|\t)/.test(line) && (index === 0 || lines[index - 1]!.trim() === "")) continue;
    const definition = LINK_DEFINITION_LINE_PATTERN.exec(line);
    lines[index] = definition
      ? definition[1] + protectLinkDestination(line.slice(definition[1]!.length))
      : protectLine(line);
  }
  return lines.join("\n");
}

// Bare prose paths need a filesystem root or a position, so `/api/users.json` stays a route,
// and a file-shaped last segment.
export function absoluteFilePathMatches(text: string): Array<{ index: number; path: string }> {
  const paths: Array<{ index: number; path: string }> = [];
  for (const match of text.matchAll(/(^|[\s(["'])(\/[^\s<>"'`]+)/g)) {
    const source = match[2]!;
    let parentheses = 0;
    let brackets = 0;
    for (const character of source) {
      if (character === "(") parentheses += 1;
      if (character === ")") parentheses -= 1;
      if (character === "[") brackets += 1;
      if (character === "]") brackets -= 1;
    }
    let end = source.length;
    while (end > 0) {
      const character = source[end - 1]!;
      if (character === ")" && parentheses < 0) parentheses += 1;
      else if (character === "]" && brackets < 0) brackets += 1;
      else if (!".,;!?:".includes(character)) break;
      end -= 1;
    }
    const path = source.slice(0, end);
    // Trimming `/tmp/a/....` to `/tmp/a/` would hide its elided segment.
    if (path.endsWith("/") && source.startsWith("...", end)) continue;
    if (
      !POSIX_FILE_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix)) &&
      !POSITION_SUFFIX_PATTERN.test(path)
    )
      continue;
    // Prose ends a path at whitespace, so `/Users/me/Library/Application Support/...` must not link.
    const basename = path.slice(path.lastIndexOf("/") + 1);
    if (
      !POSITION_SUFFIX_PATTERN.test(path) &&
      !FILE_EXTENSION_PATTERN.test(basename) &&
      !EXTENSIONLESS_FILE_NAMES.has(basename)
    )
      continue;
    if (!parseMarkdownFileLink(path)) continue;
    paths.push({ index: match.index + match[1]!.length, path });
  }
  return paths;
}

// A drive path that has not reached whitespace yet: `C:`, `C:\Users\me`, `C:/work`.
export const UNFINISHED_DRIVE_PATH = /(?:^|\W)[A-Za-z]:(?:[\\/]\S*)?$/;
