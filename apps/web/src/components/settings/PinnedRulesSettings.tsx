import { useRef } from "react";

import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function PinnedRulesSettings() {
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const edited = useRef(false);
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["pinnedRules"]);

  return (
    <SettingsRow
      serverScoped
      settingKeys={["pinnedRules"]}
      {...searchableSetting("pinned-rules")}
      description="Re-sent verbatim after every context compaction. Applies to Claude and Codex threads; edits apply on the next message (Codex), or after the next compaction or when a session starts (Claude)."
      resetAction={
        mixed || settings.pinnedRules !== "" ? (
          <SettingResetButton
            label="pinned rules"
            onClick={() => updateSettings({ pinnedRules: "" })}
          />
        ) : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          key={`${scopeKey}:${mixed}:${settings.pinnedRules}`}
          aria-label="Pinned rules"
          onChange={() => {
            edited.current = true;
          }}
          rows={6}
          defaultValue={mixed ? "" : settings.pinnedRules}
          placeholder={
            mixed
              ? "Mixed. Enter rules to apply to all selected targets."
              : "Never edit files under generated/. Run the tests before saying a task is done."
          }
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && (mixed || value !== settings.pinnedRules))
              updateSettings({ pinnedRules: value });
            edited.current = false;
          }}
        />
      </div>
    </SettingsRow>
  );
}
