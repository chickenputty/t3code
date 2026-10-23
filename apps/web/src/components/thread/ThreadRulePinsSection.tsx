import type { ScopedThreadRef, ThreadRulePin } from "@t3tools/contracts";
import { PencilIcon, PinOffIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useThreadRulePins } from "~/hooks/useThreadRulePins";

import { ThreadTabSection } from "./ThreadOverviewTab";
import { rulePinDraftIssue } from "./threadRulePins.logic";

const ISSUE_MESSAGES = {
  empty: "Write something to pin.",
  "too-long": "That is too long to pin.",
  "total-too-long": "This thread's pins are full. Shorten or unpin another one first.",
  unchanged: "Nothing has changed.",
} as const;

/**
 * The thread's pinned rules: sent on every turn after the project's rules and
 * kept through compaction. Shown even where the server cannot change them, so
 * pins made elsewhere stay visible; the controls need server support.
 */
export function ThreadRulePinsSection({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const rulePins = useThreadRulePins(threadRef);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  if (!rulePins.supported && rulePins.pins.length === 0) return null;

  return (
    <ThreadTabSection title="Pinned rules">
      <div className="flex flex-col gap-2">
        {rulePins.pins.length === 0 && editing !== "new" ? (
          <p className="text-muted-foreground text-sm">
            Pin a message from its actions, or add a rule here, and every turn in this thread
            follows it.
          </p>
        ) : null}
        {rulePins.pins.map((pin) =>
          editing === pin.id ? (
            <PinEditor
              key={pin.id}
              current={pin}
              pins={rulePins.pins}
              onCancel={() => setEditing(null)}
              onSave={(text) => rulePins.edit(pin.id, text)?.then(() => setEditing(null))}
            />
          ) : (
            <PinRow
              key={pin.id}
              pin={pin}
              canChange={rulePins.supported}
              onEdit={() => setEditing(pin.id)}
              onRemove={() => void rulePins.remove(pin.id)}
            />
          ),
        )}
        {editing === "new" ? (
          <PinEditor
            current={null}
            pins={rulePins.pins}
            onCancel={() => setEditing(null)}
            onSave={(text) => rulePins.addText(text)?.then(() => setEditing(null))}
          />
        ) : rulePins.supported ? (
          <div>
            <Button variant="outline" size="xs" onClick={() => setEditing("new")}>
              <PlusIcon />
              Add rule
            </Button>
          </div>
        ) : null}
      </div>
    </ThreadTabSection>
  );
}

function PinRow({
  pin,
  canChange,
  onEdit,
  onRemove,
}: {
  readonly pin: ThreadRulePin;
  readonly canChange: boolean;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/70 p-2">
      <p className="line-clamp-6 min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">
        {pin.text}
      </p>
      {canChange ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <Button size="icon-xs" variant="ghost-muted" aria-label="Edit pin" onClick={onEdit}>
            <PencilIcon />
          </Button>
          <Button size="icon-xs" variant="ghost-muted" aria-label="Unpin" onClick={onRemove}>
            <PinOffIcon />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PinEditor({
  current,
  pins,
  onSave,
  onCancel,
}: {
  readonly current: ThreadRulePin | null;
  readonly pins: ReadonlyArray<ThreadRulePin>;
  readonly onSave: (text: string) => Promise<unknown> | undefined;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(current?.text ?? "");
  const [saving, setSaving] = useState(false);
  const issue = rulePinDraftIssue({ draft, current, pins });

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label={current === null ? "New pinned rule" : "Pinned rule"}
        autoFocus
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          disabled={issue !== null || saving}
          onClick={() => {
            setSaving(true);
            void Promise.resolve(onSave(draft.trim())).finally(() => setSaving(false));
          }}
        >
          Save
        </Button>
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {issue !== null && draft !== (current?.text ?? "") ? (
          <span className="text-muted-foreground text-xs">{ISSUE_MESSAGES[issue]}</span>
        ) : null}
      </div>
    </div>
  );
}
