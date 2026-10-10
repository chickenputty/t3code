import { isUncPath, isWindowsAbsolutePath, stripSlashPrefixedWindowsDrive } from "./path.ts";
import {
  type FilePathPosition,
  formatFilePathPosition,
  parseFileUrlHref,
  resolvePathLinkTarget,
  splitFilePathPosition,
} from "./fileLinks.ts";

const RELATIVE_PATH_PREFIX_PATTERN = /^(~\/|\.{1,2}\/)/;

const RELATIVE_FILE_PATH_PATTERN =
  /^(?:[A-Za-z0-9._-]+(?: +[A-Za-z0-9._-]+)*\/)+[A-Za-z0-9._-]+(?: +[A-Za-z0-9._-]+)*(?::\d+){0,2}$/;

const RELATIVE_FILE_NAME_PATTERN =
  /^[A-Za-z0-9._-]+(?: +[A-Za-z0-9._-]+)*\.[A-Za-z0-9_-]+(?::\d+){0,2}$/;

const EXTERNAL_SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/;

const POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;

const POSITION_ONLY_PATTERN = /^\d+(?::\d+)?$/;

const INLINE_CODE_DISQUALIFIER_PATTERN = /[\s`]/;

const INLINE_CODE_PLACEHOLDER_PATTERN = /[<>*?{}|]|\.\.\.|…/;

// Fork: Git Bash writes `C:\Users` as `/c/Users`.
const MSYS_DRIVE_PATH_PATTERN =
  /^\/([A-Za-z])\/(?=(?:Users|ProgramData|Program Files|Windows)\/|.*\.[A-Za-z0-9_-]+(?::\d+){0,2}$)/;

const PATH_SEPARATOR_PATTERN = /[\\/]/;

const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9_-]+$/;
// A final dot between digits marks a version or model id (`glm-5.3`,
// `Qwen2.5-Coder`), not an extension. `ls.1` and `libfoo.so.1` stay files.
const VERSION_SUFFIX_PATTERN = /\d\.\d[^.]*$/;
const NUMERIC_DOTTED_PATTERN = /^\d+(?:\.\d+)+$/;

// Standard OS and dev-container roots; deliberately excludes app-route-ish
// prefixes like /app/ or /chat/ so SPA routes never read as files.
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

// `Name:digits` also matches `error:1`, `port:3000`, and `TODO:12`.
const EXTENSIONLESS_FILE_NAMES = new Set([
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

// These allowlists avoid classifying dotted directories such as `conf.d/`
// or filenames such as `Makefile.in:12` as hosts.
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
  "cc",
  "gg",
  "chat",
  "cloud",
  "site",
  "online",
  "tech",
  "store",
  "link",
]);

// Country codes also name file extensions. A :line suffix makes `.pl`
// and `.pt` files more likely than hostnames.
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

/**
 * Picks path-shaped inline code for the client's markdown file-link resolver.
 * It does not resolve paths or turn plain prose and fenced code into links.
 */
export function inlineCodeFilePathCandidate(codeText: string): string | null {
  const trimmed = codeText.trim();
  // Fork: `<dir>`, `*.ts`, `{a,b}` and `...` describe a path rather than name one.
  if (INLINE_CODE_PLACEHOLDER_PATTERN.test(trimmed)) return null;
  // Fork: a Windows path may hold spaces (`C:\Users\me\Pet Vault\notes.md`);
  // a space before `-` or `/` reads as a command's arguments instead.
  const unquoted = /^"[^"]+"$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
  if (
    isWindowsAbsolutePath(unquoted) &&
    /\s/.test(unquoted) &&
    !/[\t\n\r`]|\s[-/]|\s{2}/.test(unquoted)
  ) {
    return unquoted;
  }
  if (trimmed.length === 0 || INLINE_CODE_DISQUALIFIER_PATTERN.test(trimmed)) return null;

  const candidate = isWindowsAbsolutePath(trimmed) ? trimmed : trimmed.replaceAll("\\", "/");
  const hasPosition = POSITION_SUFFIX_PATTERN.test(candidate);
  if (!hasPosition && !PATH_SEPARATOR_PATTERN.test(candidate)) return null;

  const hasExplicitPathShape =
    RELATIVE_PATH_PREFIX_PATTERN.test(candidate) ||
    candidate.startsWith("/") ||
    isWindowsAbsolutePath(candidate);
  if (!hasExplicitPathShape) {
    const withoutPosition = candidate.replace(POSITION_SUFFIX_PATTERN, "");
    const firstSegment = withoutPosition.split("/")[0] ?? withoutPosition;
    if (looksLikeHostname(firstSegment, hasPosition)) return null;
    const basename =
      withoutPosition
        .replace(/[/\\]+$/, "")
        .split(/[\\/]/)
        .at(-1) ?? "";
    if (VERSION_SUFFIX_PATTERN.test(basename)) return null;
    if (!hasPosition && !FILE_EXTENSION_PATTERN.test(basename)) return null;
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

/** Keeps filename and destination-path labels compact without discarding prose. */
export function isMarkdownFileLinkLabel(label: string, href: string): boolean {
  const destination = parseMarkdownFileLink(href);
  if (!destination) return false;
  const normalize = (path: string) =>
    path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const labelPosition = splitFilePathPosition(label.trim());
  if (
    (labelPosition.line !== undefined && labelPosition.line !== destination.line) ||
    (labelPosition.column !== undefined && labelPosition.column !== destination.column)
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

/**
 * Decides whether a decoded link destination is a file path rather than a route
 * or prose. Only a `:line` suffix the author wrote counts as evidence; a `#L`
 * anchor never turns `/chat/settings` into a file.
 */
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
  // A percent-encoded drive colon (`/c%3A/`) only becomes strippable once decoded.
  const path = stripSlashPrefixedWindowsDrive(safeDecodeURIComponent(source.path.trim()));
  const hash = safeDecodeURIComponent(source.hash.trim());
  if (path.length === 0 || hasExternalScheme(path)) return null;

  const position = splitFilePathPosition(path, hash);
  return looksLikeFilePath(position.path, path) ? position : null;
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

const MARKDOWN_LINK_HREF_PATTERN =
  /\[[^\]]*]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;

export function extractMarkdownLinkHrefs(markdown: string): string[] {
  const hrefs: string[] = [];
  for (const match of markdown.matchAll(MARKDOWN_LINK_HREF_PATTERN)) {
    const href = (match[1] ?? match[2])?.trim();
    if (href) hrefs.push(href);
  }
  return hrefs;
}

/**
 * `baseDir` anchors relative links; it defaults to the workspace root and is the
 * file's own directory when rendering a markdown file. `cwd` stays the workspace
 * root so the result still knows whether the target is inside it.
 */
export function resolveMarkdownFileLinkTarget(
  href: string | undefined,
  cwd?: string,
  baseDir: string | undefined = cwd,
): string | null {
  if (!href) return null;
  const target = parseMarkdownFileLink(href);
  if (!target) return null;

  const pathWithPosition = formatFilePathPosition(target);
  const msysDrive = MSYS_DRIVE_PATH_PATTERN.exec(pathWithPosition)?.[1];
  if (msysDrive && (cwd ?? baseDir) && isWindowsAbsolutePath(cwd ?? baseDir ?? "")) {
    return `${msysDrive.toUpperCase()}:/${pathWithPosition.slice(3)}`;
  }
  if (!isRelativeFilePath(pathWithPosition)) return pathWithPosition;
  if (!baseDir) return null;
  return resolvePathLinkTarget(pathWithPosition, baseDir);
}

export function isWindowsDrivePathHref(href: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(safeDecodeURIComponent(href));
}

// Fork (chickenputty/t3code): agents on Windows write paths that CommonMark
// cannot read as written. A space ends an unwrapped link destination, so
// `![shot](C:\Users\me\Pet Vault\x.png)` renders as raw text, and a backslash
// before punctuation is an escape in prose, so `Pet Vault\_coordination` loses
// it. `protectFilePathsInMarkdown` rewrites a message before it is parsed:
// spaced Windows destinations get angle brackets, and Windows paths in prose
// become links whose label keeps every backslash. Code is never touched.

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
 * The Windows path in prose that starts at `from`. A folder name may hold
 * spaces (`BIG Games Dropbox`), so the path runs on across up to four plain
 * words when a later word continues it with a separator, or, at the end of a
 * sentence, when every word is capitalized (`...\Pet Vault.`). A segment with a
 * file extension ends the path.
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
