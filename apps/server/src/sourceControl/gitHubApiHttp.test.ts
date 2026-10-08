import { assert, afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/process";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubApiHttp from "./gitHubApiHttp.ts";
import * as GitHubCli from "./GitHubCli.ts";

const QUERY = JSON.stringify({ query: "query { viewer { login } }", variables: {} });

describe("parseGhApiArgs", () => {
  it("sends a GraphQL document from stdin as the body", () => {
    const request = GitHubApiHttp.parseGhApiArgs(
      ["api", "graphql", "--hostname", "github.com", "--input", "-"],
      QUERY,
    );
    expect(request).toMatchObject({
      method: "POST",
      url: "https://api.github.com/graphql",
      body: QUERY,
      graphql: true,
    });
  });

  it("builds a GraphQL body from fields, typed where gh types them", () => {
    const request = GitHubApiHttp.parseGhApiArgs(
      [
        "api",
        "graphql",
        "--hostname",
        "github.com",
        "-f",
        "query=query($n: Int!) { x }",
        "-F",
        "n=7",
        "-f",
        "owner=me",
      ],
      undefined,
    );
    expect(JSON.parse(request!.body!)).toEqual({
      query: "query($n: Int!) { x }",
      variables: { n: 7, owner: "me" },
    });
  });

  it("keeps a REST read a GET, with its headers", () => {
    const request = GitHubApiHttp.parseGhApiArgs(
      [
        "api",
        "repos/o/r/commits/abc/check-runs",
        "--hostname",
        "github.com",
        "--include",
        "--silent",
        "-H",
        'If-None-Match: W/"etag"',
      ],
      undefined,
    );
    expect(request).toMatchObject({
      method: "GET",
      url: "https://api.github.com/repos/o/r/commits/abc/check-runs",
      body: undefined,
      include: true,
      silent: true,
    });
    expect(request?.headers["If-None-Match"]).toBe('W/"etag"');
  });

  it("puts GET fields in the query string and other fields in a JSON body", () => {
    expect(
      GitHubApiHttp.parseGhApiArgs(
        ["api", "--method", "GET", "--hostname", "github.com", "search/issues", "-f", "q=a b"],
        undefined,
      )?.url,
    ).toBe("https://api.github.com/search/issues?q=a+b");
    expect(
      GitHubApiHttp.parseGhApiArgs(
        ["api", "--hostname", "github.com", "repos/o/r/issues/1/comments", "-f", "body=hi"],
        undefined,
      ),
    ).toMatchObject({ method: "POST", body: JSON.stringify({ body: "hi" }) });
  });

  it("leaves to gh what it cannot reproduce", () => {
    const unsupported: ReadonlyArray<ReadonlyArray<string>> = [
      ["api", "repos/o/r/pulls/1/files", "--hostname", "github.com", "--jq", ".[]"],
      ["api", "repos/o/r/pulls", "--hostname", "github.com", "--paginate"],
      ["api", "repos/{owner}/{repo}/pulls", "--hostname", "github.com"],
      ["api", "graphql", "--hostname", "ghe.example.com", "--input", "-"],
      ["api", "repos/o/r"],
      ["api", "repos/o/r", "--hostname", "github.com", "-F", "body=@file.md"],
      ["pr", "view", "1"],
    ];
    for (const args of unsupported) {
      expect(GitHubApiHttp.parseGhApiArgs(args, QUERY), args.join(" ")).toBeNull();
    }
  });
});

describe("renderGhApiResponse", () => {
  const graphql = GitHubApiHttp.parseGhApiArgs(
    ["api", "graphql", "--hostname", "github.com", "--input", "-"],
    QUERY,
  )!;
  const rest = GitHubApiHttp.parseGhApiArgs(
    ["api", "repos/o/r/pulls/9", "--hostname", "github.com", "--include"],
    undefined,
  )!;

  it("prints a successful body as is", () => {
    expect(
      GitHubApiHttp.renderGhApiResponse(graphql, {
        status: 200,
        statusText: "OK",
        headers: [],
        body: '{"data":{}}',
      }),
    ).toEqual({ code: 0, stdout: '{"data":{}}', stderr: "" });
  });

  it("fails a GraphQL answer that carries errors, with gh's message", () => {
    const result = GitHubApiHttp.renderGhApiResponse(graphql, {
      status: 200,
      statusText: "OK",
      headers: [],
      body: JSON.stringify({
        data: null,
        errors: [{ message: "Could not resolve to a PullRequest with the number of 9." }],
      }),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("gh: Could not resolve to a PullRequest with the number of 9.\n");
  });

  it("prints headers in gh's form before the body, and fails an HTTP error", () => {
    const result = GitHubApiHttp.renderGhApiResponse(rest, {
      status: 403,
      statusText: "Forbidden",
      headers: [
        ["x-ratelimit-remaining", "0"],
        ["content-type", "application/json"],
      ],
      body: JSON.stringify({ message: "API rate limit exceeded for user ID 1." }),
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe(
      'HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nX-Ratelimit-Remaining: 0\r\n\r\n{"message":"API rate limit exceeded for user ID 1."}',
    );
    expect(result.stderr).toBe("gh: API rate limit exceeded for user ID 1. (HTTP 403)\n");
  });

  it("reports a 304 as gh does", () => {
    const result = GitHubApiHttp.renderGhApiResponse(rest, {
      status: 304,
      statusText: "Not Modified",
      headers: [["etag", 'W/"a"']],
      body: "",
    });
    expect(result).toEqual({
      code: 1,
      stdout: 'HTTP/1.1 304 Not Modified\r\nEtag: W/"a"\r\n\r\n',
      stderr: "gh: HTTP 304\n",
    });
  });
});

describe("GitHubCli over HTTP", () => {
  const output = (stdout: string): VcsProcess.VcsProcessOutput => ({
    exitCode: ChildProcessSpawner.ExitCode(0),
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  });
  const run = vi.fn<VcsProcess.VcsProcess["Service"]["run"]>();
  const transport = vi.fn<GitHubApiHttp.GhApiTransport>();
  const layer = GitHubCli.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(VcsProcess.VcsProcess)({ run: (input) => run(input) }),
        Layer.succeed(GitHubApiHttp.GitHubApiTransport, (request) => transport(request)),
      ),
    ),
  );
  const isAuthToken = (input: VcsProcess.VcsProcessInput) =>
    input.args[0] === "auth" && input.args[1] === "token";

  afterEach(() => {
    run.mockReset();
    transport.mockReset();
    vi.unstubAllEnvs();
  });

  it.effect("answers a GraphQL read with gh's stored login and starts no other gh", () =>
    Effect.gen(function* () {
      vi.stubEnv("GH_TOKEN", "");
      vi.stubEnv("GITHUB_TOKEN", "");
      run.mockImplementation((input) =>
        isAuthToken(input)
          ? Effect.succeed(output("stored-token\n"))
          : Effect.die(new Error(`gh should not start: ${input.args.join(" ")}`)),
      );
      transport.mockImplementation(() =>
        Effect.succeed({ status: 200, statusText: "OK", headers: [], body: '{"data":{"ok":1}}' }),
      );
      const github = yield* GitHubCli.GitHubCli;
      const args = ["api", "graphql", "--hostname", "github.com", "--input", "-"];
      const first = yield* github.execute({ cwd: "/repo", args, stdin: QUERY });
      yield* github.execute({ cwd: "/repo", args, stdin: QUERY });
      assert.strictEqual(first.stdout, '{"data":{"ok":1}}');
      assert.strictEqual(run.mock.calls.length, 1);
      assert.strictEqual(transport.mock.calls[0]![0].token, "stored-token");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("classifies a GraphQL not-found answer like gh's exit", () =>
    Effect.gen(function* () {
      transport.mockImplementation(() =>
        Effect.succeed({
          status: 200,
          statusText: "OK",
          headers: [],
          body: JSON.stringify({
            errors: [{ message: "Could not resolve to a PullRequest with the number of 9." }],
          }),
        }),
      );
      const github = yield* GitHubCli.GitHubCli;
      const error = yield* github
        .execute({
          cwd: "/repo",
          args: ["api", "graphql", "--hostname", "github.com", "--input", "-"],
          stdin: QUERY,
          env: { GH_TOKEN: "env-token" },
        })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "GitHubPullRequestNotFoundError");
      assert.strictEqual(run.mock.calls.length, 0);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("lets gh answer when GitHub refuses the token or the form is not reproduced", () =>
    Effect.gen(function* () {
      run.mockImplementation(() => Effect.succeed(output("from gh")));
      transport.mockImplementation(() =>
        Effect.succeed({
          status: 401,
          statusText: "Unauthorized",
          headers: [],
          body: '{"message":"Bad credentials"}',
        }),
      );
      const github = yield* GitHubCli.GitHubCli;
      const refused = yield* github.execute({
        cwd: "/repo",
        args: ["api", "repos/o/r", "--hostname", "github.com"],
        env: { GH_TOKEN: "env-token" },
      });
      const jq = yield* github.execute({
        cwd: "/repo",
        args: ["api", "repos/o/r", "--hostname", "github.com", "--jq", ".name"],
        env: { GH_TOKEN: "env-token" },
      });
      assert.strictEqual(refused.stdout, "from gh");
      assert.strictEqual(jq.stdout, "from gh");
      assert.strictEqual(transport.mock.calls.length, 1);
      assert.deepStrictEqual(
        run.mock.calls.map(([input]) => input.args.at(-1)),
        ["github.com", ".name"],
      );
    }).pipe(Effect.provide(layer)),
  );
});
