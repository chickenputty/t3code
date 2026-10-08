import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import type { HttpMethod } from "effect/http/HttpMethod";
import * as Layer from "effect/Layer";

/**
 * Fork: `gh api` calls answered over HTTP from the server instead of a `gh` process.
 *
 * Every pull request read started a `gh` process, and on a busy Windows machine a process start
 * takes seconds. The calls the server makes most (`gh api graphql --hostname <host> --input -`
 * and plain REST reads) are rebuilt here as the request gh would send, and the answer is
 * rendered the way gh prints it: the body on stdout, `--include` headers before it, a `gh: ...`
 * line on stderr and exit code 1 for an HTTP error or a GraphQL error. Callers keep parsing the
 * same text. Anything this does not reproduce exactly (`--jq`, `--paginate`, endpoint
 * placeholders, files, hosts other than github.com) returns null from `parseGhApiArgs` and
 * still runs through gh.
 */

/**
 * Sends one request and reads the whole answer. The server provides an `HttpClient` transport;
 * without one (tests, `T3_GH_HTTP=0`) every call runs through gh.
 */
export type GhApiTransport = (
  request: GhApiRequest & { readonly token: string; readonly timeoutMs: number },
) => Effect.Effect<GhApiHttpResponse, GitHubApiTransportError>;

/** The request never got an answer: a network failure or the timeout. */
export class GitHubApiTransportError extends Data.TaggedError("GitHubApiTransportError")<{
  readonly cause: unknown;
}> {}

/** The transport `GitHubCli` answers `gh api` calls with; undefined runs them all through gh. */
export const GitHubApiTransport = Context.Reference<GhApiTransport | undefined>(
  "t3/sourceControl/GitHubApiTransport",
  { defaultValue: () => undefined },
);

/** Provides the HTTP transport unless `T3_GH_HTTP=0`. */
export const layer = Layer.effect(
  GitHubApiTransport,
  Effect.gen(function* () {
    if (globalThis.process.env.T3_GH_HTTP === "0") return undefined;
    const client = yield* HttpClient.HttpClient;
    const transport: GhApiTransport = (request) =>
      client
        .execute(
          HttpClientRequest.make(request.method)(request.url).pipe(
            HttpClientRequest.setHeaders({
              ...request.headers,
              Authorization: `token ${request.token}`,
              "User-Agent": "T3 Code",
            }),
            request.body === undefined
              ? (built) => built
              : HttpClientRequest.bodyText(request.body, request.headers["Content-Type"]),
          ),
        )
        .pipe(
          Effect.flatMap((response) =>
            Effect.map(response.text, (body) => ({
              status: response.status,
              statusText: STATUS_TEXT[response.status] ?? "",
              headers: Object.entries(response.headers),
              body,
            })),
          ),
          Effect.scoped,
          Effect.timeout(request.timeoutMs),
          Effect.mapError((cause) => new GitHubApiTransportError({ cause })),
        );
    return transport;
  }),
).pipe(Layer.provide(FetchHttpClient.layer));

/** Reason phrases for the status line `--include` prints; callers read only the code. */
const STATUS_TEXT: Readonly<Record<number, string>> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  304: "Not Modified",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
};

/** The methods `gh api` calls here use; anything else runs through gh. */
const METHODS: ReadonlyArray<HttpMethod> = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export interface GhApiRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
  readonly graphql: boolean;
  readonly include: boolean;
  readonly silent: boolean;
}

export interface GhApiHttpResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: ReadonlyArray<readonly [name: string, value: string]>;
  readonly body: string;
}

export interface GhApiResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Turns `gh api` arguments into the request gh would send, or null when gh must run it. */
export function parseGhApiArgs(
  args: ReadonlyArray<string>,
  stdin: string | undefined,
): GhApiRequest | null {
  if (args[0] !== "api") return null;
  let host: string | undefined;
  let method: string | undefined;
  let endpoint: string | undefined;
  let input: string | undefined;
  let include = false;
  let silent = false;
  const headers: Record<string, string> = {};
  const fields: Array<readonly [string, unknown]> = [];
  for (let index = 1; index < args.length; index++) {
    const arg = args[index]!;
    const value = () => args[++index];
    switch (arg) {
      case "--hostname":
        host = value();
        break;
      case "-X":
      case "--method":
        method = value()?.toUpperCase();
        break;
      case "-i":
      case "--include":
        include = true;
        break;
      case "--silent":
        silent = true;
        break;
      case "--input":
        input = value();
        if (input !== "-") return null;
        break;
      case "-H":
      case "--header": {
        const header = value();
        const colon = header?.indexOf(":") ?? -1;
        if (header === undefined || colon <= 0) return null;
        headers[header.slice(0, colon).trim()] = header.slice(colon + 1).trim();
        break;
      }
      case "-f":
      case "--raw-field":
      case "-F":
      case "--field": {
        const field = value();
        const equals = field?.indexOf("=") ?? -1;
        if (field === undefined || equals <= 0) return null;
        const key = field.slice(0, equals);
        const raw = field.slice(equals + 1);
        // Nested and array keys, and `@file` values, are left to gh.
        if (/[[\]]/.test(key)) return null;
        if (arg === "-F" || arg === "--field") {
          if (raw.startsWith("@")) return null;
          fields.push([key, typedField(raw)]);
        } else {
          fields.push([key, raw]);
        }
        break;
      }
      default:
        if (arg.startsWith("-") || endpoint !== undefined) return null;
        endpoint = arg;
    }
  }
  if (host === undefined || endpoint === undefined) return null;
  // Placeholders resolve from the checkout, and full URLs pick their own host.
  if (/[{}]/.test(endpoint) || /^[a-z]+:/i.test(endpoint)) return null;
  if (input === "-" && stdin === undefined) return null;
  // Enterprise and ghe.com hosts pick their API address and token differently; gh runs those.
  host = host.toLowerCase();
  if (host !== "github.com") return null;

  const graphql = endpoint === "graphql";
  let url = `https://api.github.com/${graphql ? "graphql" : endpoint.replace(/^\/+/, "")}`;
  let body: string | undefined;
  if (input === "-") {
    // gh sends the input as the body and the fields as the query string.
    if (fields.length > 0) {
      if (graphql) return null;
      url = withQuery(url, fields);
    }
    body = stdin;
    method ??= "POST";
  } else if (graphql) {
    const query = fields.find(([key]) => key === "query")?.[1];
    if (typeof query !== "string") return null;
    const variables: Record<string, unknown> = {};
    let operationName: unknown;
    for (const [key, field] of fields) {
      if (key === "query") continue;
      if (key === "operationName") operationName = field;
      else variables[key] = field;
    }
    body = JSON.stringify({
      query,
      ...(operationName === undefined ? {} : { operationName }),
      ...(Object.keys(variables).length === 0 ? {} : { variables }),
    });
    method ??= "POST";
  } else if (fields.length > 0) {
    method ??= "POST";
    if (method === "GET") url = withQuery(url, fields);
    else body = JSON.stringify(Object.fromEntries(fields));
  } else {
    method ??= "GET";
  }
  const known = METHODS.find((candidate) => candidate === method);
  if (known === undefined || (graphql && known !== "POST")) return null;
  return {
    method: known,
    url,
    headers: {
      Accept:
        "application/vnd.github.merge-info-preview+json, application/vnd.github.nebula-preview",
      ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
      ...headers,
    },
    body,
    graphql,
    include,
    silent,
  };
}

/** gh's typed `-F` values: booleans, null and integers, else the string. */
function typedField(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}

function withQuery(url: string, fields: ReadonlyArray<readonly [string, unknown]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of fields) params.append(key, String(value));
  return `${url}${url.includes("?") ? "&" : "?"}${params.toString()}`;
}

/** Go's canonical header name, which gh prints: `x-ratelimit-reset` is `X-Ratelimit-Reset`. */
function canonicalHeader(name: string): string {
  return name
    .toLowerCase()
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

function errorMessage(body: string, graphql: boolean, status: number): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as { message?: unknown; errors?: unknown };
  const errors = Array.isArray(record.errors)
    ? record.errors.flatMap((error) => {
        if (typeof error === "string") return [error];
        if (typeof error === "object" && error !== null) {
          const message = (error as { message?: unknown }).message;
          if (typeof message === "string") return [message];
        }
        return [];
      })
    : [];
  if (graphql && status <= 299) return errors.length > 0 ? errors.join("\n") : null;
  if (status <= 299) return null;
  const message = [typeof record.message === "string" ? record.message : "", ...errors]
    .filter((part) => part !== "")
    .join("\n");
  return message === "" ? null : `${message} (HTTP ${status})`;
}

/** Renders a response the way `gh api` prints it, with the exit code gh returns. */
export function renderGhApiResponse(
  request: GhApiRequest,
  response: GhApiHttpResponse,
): GhApiResult {
  let stdout = "";
  if (request.include) {
    stdout += `HTTP/1.1 ${response.status} ${response.statusText}\r\n`;
    const grouped = new Map<string, Array<string>>();
    for (const [name, value] of response.headers) {
      const key = canonicalHeader(name);
      grouped.set(key, [...(grouped.get(key) ?? []), value]);
    }
    for (const key of [...grouped.keys()].toSorted()) {
      stdout += `${key}: ${grouped.get(key)!.join(", ")}\r\n`;
    }
    stdout += "\r\n";
  }
  if (response.status === 204) return { code: 0, stdout, stderr: "" };
  if (!request.silent) stdout += response.body;
  const message = errorMessage(response.body, request.graphql, response.status);
  if (message !== null) return { code: 1, stdout, stderr: `gh: ${message}\n` };
  if (response.status > 299) return { code: 1, stdout, stderr: `gh: HTTP ${response.status}\n` };
  return { code: 0, stdout, stderr: "" };
}

/** The token gh reads from the environment for github.com before its stored login. */
export function environmentToken(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN"]) {
    const value = env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}
