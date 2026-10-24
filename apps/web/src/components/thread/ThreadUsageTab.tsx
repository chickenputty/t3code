/** Fork (chickenputty/t3code): the tokens and models a thread has used. */
import { formatTokens, type InspectorModel } from "~/components/views/inspectorModel";

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-border/60 px-3 py-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium text-lg tabular-nums">{value}</span>
    </div>
  );
}

export function ThreadUsageTab({ model }: { model: InspectorModel }) {
  const { usage } = model;
  const reported = usage.inputTokens + usage.outputTokens > 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Input tokens" value={formatTokens(usage.inputTokens)} />
        <Stat label="Cached input" value={formatTokens(usage.cachedInputTokens)} />
        <Stat label="Output tokens" value={formatTokens(usage.outputTokens)} />
        <Stat label="Reasoning" value={formatTokens(usage.reasoningTokens)} />
      </div>
      {usage.contextUsed !== null ? (
        <p className="text-sm">
          Context window: {formatTokens(usage.contextUsed)}
          {usage.contextMax ? ` of ${formatTokens(usage.contextMax)}` : ""} used
        </p>
      ) : null}
      <p className="text-sm">
        Models:{" "}
        <span className="text-muted-foreground">{usage.models.join(", ") || "none yet"}</span>
      </p>
      {!reported ? (
        <p className="text-muted-foreground text-xs">
          This provider has not reported token usage for these turns.
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">
        Cost estimates per thread are not tracked yet; the Usage page prices usage by model and day.
      </p>
    </div>
  );
}
