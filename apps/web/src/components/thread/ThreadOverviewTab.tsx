/**
 * Fork (chickenputty/t3code): a thread's actions and properties, shown in the
 * chat pane's Overview tab and in a saved view's thread inspector.
 */
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BellDotIcon,
  CheckCheckIcon,
  CircleDotIcon,
  ClockIcon,
  PinIcon,
  PinOffIcon,
  SunIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import type { InspectorModel } from "~/components/views/inspectorModel";
import type { ViewBulkAction } from "~/components/views/useViewThreadOps";
import {
  formatViewPropertyValue,
  type ViewRow,
  VIEW_PROPERTIES,
} from "~/components/views/viewEngine";

export function ThreadTabSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{title}</h3>
      {children}
    </section>
  );
}

export function ThreadOverviewTab({
  row,
  model,
  nowMs,
  onAction,
  ledger,
}: {
  row: ViewRow;
  model: InspectorModel | null;
  nowMs: number;
  onAction: (row: ViewRow, action: ViewBulkAction) => void;
  /** The task ledger section, shown above the properties when the thread has one. */
  ledger?: ReactNode;
}) {
  const archived = row.section === "archived";
  const actions: { action: ViewBulkAction; label: string; icon: ReactNode }[] = archived
    ? [{ action: "unarchive", label: "Unarchive", icon: <ArchiveRestoreIcon /> }]
    : [
        row.pinned
          ? { action: "unpin", label: "Unpin", icon: <PinOffIcon /> }
          : { action: "pin", label: "Pin", icon: <PinIcon /> },
        row.section === "settled"
          ? { action: "unsettle", label: "Un-settle", icon: <CircleDotIcon /> }
          : { action: "settle", label: "Settle", icon: <CheckCheckIcon /> },
        row.section === "snoozed"
          ? { action: "unsnooze", label: "Wake", icon: <SunIcon /> }
          : { action: "snooze", label: "Snooze until tomorrow", icon: <ClockIcon /> },
        { action: "mark-unread", label: "Mark unread", icon: <BellDotIcon /> },
        { action: "archive", label: "Archive", icon: <ArchiveIcon /> },
      ];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-1.5">
        {actions.map((entry) => (
          <Button
            key={entry.action}
            variant="outline"
            size="xs"
            onClick={() => onAction(row, entry.action)}
          >
            {entry.icon}
            {entry.label}
          </Button>
        ))}
      </div>
      {ledger}
      <ThreadTabSection title="Properties">
        <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
          {VIEW_PROPERTIES.filter((property) => property.id !== "title").map((property) => {
            const text = formatViewPropertyValue(property, row, nowMs);
            return (
              <div key={property.id} className="contents">
                <dt className="text-muted-foreground">{property.label}</dt>
                <dd className="min-w-0 break-words">
                  {text === "" ? <span className="text-muted-foreground/60">Empty</span> : text}
                  {property.type === "date" && text !== "" ? (
                    <span className="ms-2 text-muted-foreground text-xs">
                      {new Date(property.value(row) as number).toLocaleString()}
                    </span>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
      </ThreadTabSection>
      {model?.firstUserMessage ? (
        <ThreadTabSection title="First message">
          <p className="line-clamp-6 whitespace-pre-wrap break-words text-sm">
            {model.firstUserMessage}
          </p>
        </ThreadTabSection>
      ) : null}
      {model && model.messages.length > 0 ? (
        <ThreadTabSection title="Latest message">
          <p className="line-clamp-10 whitespace-pre-wrap break-words text-sm">
            {model.messages.at(-1)!.text}
          </p>
        </ThreadTabSection>
      ) : null}
    </div>
  );
}
