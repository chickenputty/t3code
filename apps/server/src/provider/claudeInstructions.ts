import type { PermissionMode, SettingSource } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { Effect, FileSystem } from "effect";
import { dirname, join, parse } from "node:path";

const AGENTS_MD_FILE_NAME = "AGENTS.md";
const CLAUDE_PROJECT_SETTING_SOURCES: ReadonlyArray<SettingSource> = ["project", "local"];

function toClaudePermissionMode(value: unknown): PermissionMode | undefined {
  switch (value) {
    case "default":
    case "acceptEdits":
    case "bypassPermissions":
    case "plan":
    case "dontAsk":
      return value;
    default:
      return undefined;
  }
}

function parentDirectoryOrUndefined(directory: string): string | undefined {
  const parent = dirname(directory);
  return parent === directory || parent === parse(directory).root ? undefined : parent;
}

const readNearestAgentsInstructions = (input: {
  readonly cwd: string | undefined;
  readonly fileSystem: FileSystem.FileSystem;
}): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const normalizedCwd = input.cwd?.trim();
    if (!normalizedCwd) {
      return undefined;
    }

    let currentDirectory: string | undefined = normalizedCwd;
    while (currentDirectory) {
      const agentsPath = join(currentDirectory, AGENTS_MD_FILE_NAME);
      const exists = yield* input.fileSystem.exists(agentsPath).pipe(
        Effect.catch(() => Effect.succeed(false)),
      );
      if (exists) {
        const instructions = yield* input.fileSystem.readFileString(agentsPath).pipe(
          Effect.catch(() => Effect.succeed("")),
        );
        const trimmed = instructions.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
      currentDirectory = parentDirectoryOrUndefined(currentDirectory);
    }

    return undefined;
  });

export function resolveClaudePermissionMode(input: {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly providerPermissionMode: unknown;
}): PermissionMode {
  const providerPermissionMode = toClaudePermissionMode(input.providerPermissionMode);
  if (providerPermissionMode) {
    return providerPermissionMode;
  }
  if (input.interactionMode === "plan") {
    return "plan";
  }
  return input.runtimeMode === "full-access" ? "bypassPermissions" : "default";
}

export const defaultClaudeSettingSources = CLAUDE_PROJECT_SETTING_SOURCES;

export const buildClaudeSystemPrompt = (input: {
  readonly cwd: string | undefined;
  readonly fileSystem: FileSystem.FileSystem;
}): Effect.Effect<
  | {
      readonly type: "preset";
      readonly preset: "claude_code";
      readonly append: string;
    }
  | undefined
> =>
  Effect.gen(function* () {
    const agentsInstructions = yield* readNearestAgentsInstructions(input);
    if (!agentsInstructions) {
      return undefined;
    }

    return {
      type: "preset",
      preset: "claude_code",
      append: `Project instructions from AGENTS.md:\n\n${agentsInstructions}`,
    } as const;
  });
