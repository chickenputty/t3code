/** Fork (chickenputty/t3code): every file a thread's turns changed. */
import type { InspectorModel } from "~/components/views/inspectorModel";

export function ThreadFilesTab({ model }: { model: InspectorModel }) {
  if (model.files.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No file changes were captured in this thread.</p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        Every file a turn changed. Open a turn's diff from the chat to see its changes.
      </p>
      <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
        {model.files.map((file) => (
          <li key={file.path} className="flex items-center gap-3 px-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
            <span className="text-muted-foreground text-xs">{file.kind}</span>
            <span className="text-success text-xs tabular-nums">+{file.additions}</span>
            <span className="text-destructive text-xs tabular-nums">-{file.deletions}</span>
            <span className="w-14 text-end text-muted-foreground text-xs tabular-nums">
              {file.turns} turn{file.turns === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
