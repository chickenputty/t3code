import {
  DEFAULT_LOADOUTS,
  LOADOUT_ROLE_NAMES,
  type Loadout,
  type LoadoutRole,
  type LoadoutRoleName,
  ProviderInstanceId,
  SOLO_LOADOUT_ID,
} from "@t3tools/contracts";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const ROLE_LABELS: Record<LoadoutRoleName, string> = {
  planner: "Planner",
  subPlanner: "Sub-planner",
  explorer: "Explorer",
  worker: "Worker",
  judge: "Judge",
};

const isBuiltIn = (loadout: Loadout) =>
  DEFAULT_LOADOUTS.some((builtIn) => JSON.stringify(builtIn) === JSON.stringify(loadout));

function withRole(loadout: Loadout, name: LoadoutRoleName, role: LoadoutRole | undefined): Loadout {
  const { [name]: _replaced, ...others } = loadout.roles;
  return { ...loadout, roles: role === undefined ? others : { ...others, [name]: role } };
}

/**
 * A role needs both an instance and a model to exist; clearing either removes it, so a half-typed
 * role is never saved. The effort is whatever the model advertises and is dropped at use if not.
 */
function roleFrom(fields: {
  instanceId: string;
  model: string;
  effort: string;
}): LoadoutRole | undefined {
  const instanceId = fields.instanceId.trim();
  const model = fields.model.trim();
  if (instanceId === "" || model === "") return undefined;
  const effort = fields.effort.trim();
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    model,
    ...(effort === "" ? {} : { effort }),
  };
}

function LoadoutEditor(props: {
  loadout: Loadout;
  onChange: (loadout: Loadout) => void;
  onRemove: () => void;
}) {
  const { loadout } = props;
  return (
    <div className="grid gap-2 border-t border-border/60 px-1 py-3 first:border-t-0">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Loadout name"
          defaultValue={loadout.name}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name !== "" && name !== loadout.name) props.onChange({ ...loadout, name });
          }}
        />
        {isBuiltIn(loadout) ? (
          <span className="shrink-0 text-muted-foreground text-xs">Built-in</span>
        ) : null}
        {/* Solo is the way back to no roles, so it stays. */}
        {loadout.id === SOLO_LOADOUT_ID ? null : (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove ${loadout.name}`}
            onClick={props.onRemove}
          >
            <Trash2Icon className="size-4" />
          </Button>
        )}
      </div>
      <Input
        aria-label="Loadout description"
        defaultValue={loadout.description}
        placeholder="When this structure is worth its cost"
        onBlur={(event) => {
          if (event.target.value !== loadout.description) {
            props.onChange({ ...loadout, description: event.target.value });
          }
        }}
      />
      {LOADOUT_ROLE_NAMES.map((name) => {
        const role = loadout.roles[name];
        const read = (row: HTMLElement) => {
          const value = (label: string) =>
            row.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.value ?? "";
          return {
            instanceId: value(`${ROLE_LABELS[name]} provider instance`),
            model: value(`${ROLE_LABELS[name]} model`),
            effort: value(`${ROLE_LABELS[name]} effort`),
          };
        };
        return (
          <div
            key={`${loadout.id}:${name}:${role?.instanceId ?? ""}:${role?.model ?? ""}:${role?.effort ?? ""}`}
            className="grid grid-cols-[6rem_1fr_1.5fr_5rem] items-center gap-2"
            onBlur={(event) => {
              // Commit when focus leaves the row, not between its own fields.
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              const next = roleFrom(read(event.currentTarget));
              if (JSON.stringify(next) !== JSON.stringify(role)) {
                props.onChange(withRole(loadout, name, next));
              }
            }}
          >
            <span className="text-muted-foreground text-xs">{ROLE_LABELS[name]}</span>
            <Input
              aria-label={`${ROLE_LABELS[name]} provider instance`}
              defaultValue={role?.instanceId ?? ""}
              placeholder="claudeAgent"
            />
            <Input
              aria-label={`${ROLE_LABELS[name]} model`}
              defaultValue={role?.model ?? ""}
              placeholder="Thread's own model"
            />
            <Input
              aria-label={`${ROLE_LABELS[name]} effort`}
              defaultValue={role?.effort ?? ""}
              placeholder="Effort"
            />
          </div>
        );
      })}
    </div>
  );
}

export function LoadoutSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["loadouts"]);
  const loadouts = settings.loadouts;
  const save = (next: ReadonlyArray<Loadout>) => updateSettings({ loadouts: [...next] });

  return (
    <SettingsRow
      serverScoped
      settingKeys={["loadouts"]}
      {...searchableSetting("loadouts")}
      description="Named agent structures a thread can run under. Every thread starts solo; roles take effect when the thread picks a loadout. An empty role runs on the thread's own model."
      resetAction={
        mixed || JSON.stringify(loadouts) !== JSON.stringify(DEFAULT_LOADOUTS) ? (
          <SettingResetButton label="loadouts" onClick={() => save(DEFAULT_LOADOUTS)} />
        ) : null
      }
    >
      <div className="mt-3 max-w-3xl pb-3.5">
        {mixed ? (
          <p className="pb-2 text-muted-foreground text-xs">
            Selected targets differ. Editing applies the list shown to all of them.
          </p>
        ) : null}
        {loadouts.map((loadout) => (
          <LoadoutEditor
            key={`${loadout.id}:${JSON.stringify(loadout)}`}
            loadout={loadout}
            onChange={(next) =>
              save(loadouts.map((candidate) => (candidate.id === loadout.id ? next : candidate)))
            }
            onRemove={() => save(loadouts.filter((candidate) => candidate.id !== loadout.id))}
          />
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            save([
              ...loadouts,
              {
                id: `custom-${Date.now().toString(36)}`,
                name: "New loadout",
                description: "",
                roles: {},
              },
            ])
          }
        >
          <PlusIcon className="size-4" />
          Add loadout
        </Button>
      </div>
    </SettingsRow>
  );
}
