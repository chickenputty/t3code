import { LayersIcon } from "lucide-react";
import { memo } from "react";

import { Select, SelectItem, SelectPopup, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControlIcon, ComposerSelectControl } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import type { ComposerLoadout } from "./useComposerLoadout";
import { useComposerMenuState } from "./useComposerMenuState";

function loadoutTooltip(loadout: ComposerLoadout): string {
  if (loadout.choice?.setBy === "agent") {
    return `Proposed by the agent: ${loadout.choice.reason ?? "no reason given"}`;
  }
  return loadout.active.description;
}

export const ComposerLoadoutPicker = memo(function ComposerLoadoutPicker(props: {
  loadout: ComposerLoadout;
  size?: "sm" | "xs";
  hidden?: boolean;
}) {
  const size = props.size ?? "sm";
  const composerFloatingLayerProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const { loadout } = props;

  return (
    <Tooltip>
      <Select
        open={open}
        onOpenChange={setOpen}
        value={loadout.active.id}
        onValueChange={(value) => {
          if (value) loadout.onSelect(value);
        }}
      >
        <TooltipTrigger render={<ComposerSelectControl size={size} aria-label="Loadout" />}>
          <ComposerControlIcon icon={LayersIcon} size={size} />
          <SelectValue data-composer-control-label>{loadout.active.name}</SelectValue>
        </TooltipTrigger>
        <SelectPopup alignItemWithTrigger={false} {...composerFloatingLayerProps}>
          {loadout.loadouts.map((option) => (
            <SelectItem key={option.id} value={option.id} hideIndicator className="min-w-64">
              <div className="grid min-w-0 gap-0.5">
                <span className="font-medium text-foreground">{option.name}</span>
                <span className="text-muted-foreground text-xs leading-4">
                  {option.description}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <TooltipPopup side="top">{loadoutTooltip(loadout)}</TooltipPopup>
    </Tooltip>
  );
});
