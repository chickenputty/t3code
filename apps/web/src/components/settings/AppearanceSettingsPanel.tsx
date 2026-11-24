import type { CSSProperties } from "react";
import { useState } from "react";
import { msg, useGT, useMessages } from "gt-react";
import {
  DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
  DEFAULT_UNIFIED_SETTINGS,
  type ChatWidth,
  type HtmlPreviewWidth,
  type EffortDisplay,
  type EnvironmentIdentificationMode,
  MAX_APPEARANCE_CONTRAST,
  MAX_GLASS_OPACITY,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MIN_APPEARANCE_CONTRAST,
  MIN_GLASS_OPACITY,
  MIN_PANEL_ANIMATION_DURATION_MS,
} from "@t3tools/contracts/settings";
import {
  resolveSidebarStageBackdropVariant,
  type SidebarStageBackdropVariant,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { useCustomThemes } from "../../hooks/useCustomThemes";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { ThemeLibrary } from "./ThemeSettings";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import {
  SIDEBAR_PROJECT_ICON_STYLE_LABELS,
  SIDEBAR_THREAD_INDENT_LABELS,
  SIDEBAR_PROJECT_ROW_DENSITY_LABELS,
  SIDEBAR_THREAD_ROW_DENSITY_LABELS,
} from "../sidebar/sidebarArrangement";
import { AdvancedSettings } from "./AdvancedSettings";
import { PanelAnimationsPreview } from "./PanelAnimationsPreview";
import { TypographySection } from "./TypographySettings";
import { ThreadDetailsItemsRow } from "./ThreadDetailsItemsRow";

const ENVIRONMENT_IDENTIFICATION_LABELS: Record<EnvironmentIdentificationMode, string> = {
  artwork: msg("Artwork"),
  "nightly-artwork": msg("Nightly artwork"),
  "dev-artwork": msg("Dev artwork"),
  pill: msg("Version pill"),
  none: msg("None"),
};

// The default "artwork" follows the running channel, so it is labeled as that channel's art,
// or as "None" on Latest. The other channel's art is offered as a fixed choice.
function environmentIdentificationOptions(
  stageVariant: SidebarStageBackdropVariant | null,
): ReadonlyArray<readonly [EnvironmentIdentificationMode, string]> {
  if (stageVariant === "dev") {
    return [
      ["artwork", msg("Dev artwork")],
      ["nightly-artwork", msg("Nightly artwork")],
      ["pill", msg("Version pill")],
      ["none", msg("None")],
    ];
  }
  if (stageVariant === "nightly") {
    return [
      ["artwork", msg("Nightly artwork")],
      ["dev-artwork", msg("Dev artwork")],
      ["pill", msg("Version pill")],
      ["none", msg("None")],
    ];
  }
  return [
    ["artwork", msg("None")],
    ["nightly-artwork", msg("Nightly artwork")],
    ["dev-artwork", msg("Dev artwork")],
  ];
}

const CHAT_WIDTH_LABELS: Record<ChatWidth, string> = {
  comfortable: msg("Comfortable"),
  wide: msg("Wide"),
  full: msg("Full", { $context: "chat width" }),
};

const HTML_PREVIEW_WIDTH_LABELS: Record<HtmlPreviewWidth, string> = {
  chat: msg("Match chat", { $context: "HTML preview width" }),
  wide: CHAT_WIDTH_LABELS.wide,
  full: CHAT_WIDTH_LABELS.full,
};

const EFFORT_DISPLAY_LABELS: Record<EffortDisplay, string> = {
  label: msg("Word", { $context: "show effort as a word" }),
  bars: msg("Bars", { $context: "show effort as bars" }),
};

export function AppearanceSettingsPanel() {
  const searchableSetting = useSearchableSetting();
  const {
    appearanceMode,
    refreshTheme,
    resolvedTheme,
    setAppearanceMode,
    setTheme,
    setThemeHalf,
    theme,
    themeHalves,
  } = useTheme();
  const gt = useGT();
  const m = useMessages();
  const customThemes = useCustomThemes();
  const [isImportThemeOpen, setIsImportThemeOpen] = useState(false);
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const environmentStageLabel = useEnvironmentStageLabel();
  const environmentStageVariant = resolveSidebarStageBackdropVariant(environmentStageLabel);
  const environmentIdentificationOptionList =
    environmentIdentificationOptions(environmentStageVariant);
  const environmentIdentificationLabel = m(
    environmentIdentificationOptionList.find(
      ([value]) => value === settings.environmentIdentificationMode,
    )?.[1] ?? ENVIRONMENT_IDENTIFICATION_LABELS[settings.environmentIdentificationMode],
  );
  const effectiveEnvironmentIdentificationMode = useEnvironmentIdentificationMode();
  const themeHidesEnvironmentArtwork =
    effectiveEnvironmentIdentificationMode === "pill" &&
    resolveSidebarStageBackdropVariant(
      environmentStageLabel,
      settings.environmentIdentificationMode,
    ) !== null;
  const environmentIdentificationDescription = themeHidesEnvironmentArtwork
    ? environmentStageVariant
      ? gt("Only built-in themes show artwork, so this theme shows the version pill.")
      : gt("Only built-in themes show artwork.")
    : environmentStageVariant
      ? gt("Choose how Dev and Nightly environments are identified.")
      : gt("Show Dev or Nightly artwork in the sidebar header.");
  const glassOpacityRatio =
    (settings.glassOpacity - MIN_GLASS_OPACITY) / (MAX_GLASS_OPACITY - MIN_GLASS_OPACITY);
  const glassOpacitySliderStyle = {
    "--settings-slider-progress": `${glassOpacityRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - glassOpacityRatio}rem`,
  } as CSSProperties;
  const appearanceContrastRatio =
    (settings.appearanceContrast - MIN_APPEARANCE_CONTRAST) /
    (MAX_APPEARANCE_CONTRAST - MIN_APPEARANCE_CONTRAST);
  const appearanceContrastSliderStyle = {
    "--settings-slider-progress": `${appearanceContrastRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - appearanceContrastRatio}rem`,
  } as CSSProperties;
  const panelAnimationDurationRatio =
    (settings.panelAnimationDurationMs - MIN_PANEL_ANIMATION_DURATION_MS) /
    (MAX_PANEL_ANIMATION_DURATION_MS - MIN_PANEL_ANIMATION_DURATION_MS);
  const panelAnimationDurationSliderStyle = {
    "--settings-slider-progress": `${panelAnimationDurationRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - panelAnimationDurationRatio}rem`,
  } as CSSProperties;

  return (
    <SettingsPageContainer>
      <SettingsSection id="appearance" title={gt("Colors & themes")} variant="plain" hideTitle>
        <div id={searchableSetting("theme").id}>
          <ThemeLibrary
            appearanceMode={appearanceMode}
            customThemes={customThemes}
            initialAppearance={resolvedTheme}
            refreshTheme={refreshTheme}
            isImportOpen={isImportThemeOpen}
            setAppearanceMode={setAppearanceMode}
            setTheme={setTheme}
            setThemeHalf={setThemeHalf}
            theme={theme}
            themeHalves={themeHalves}
            onImportOpenChange={setIsImportThemeOpen}
          />
        </div>
      </SettingsSection>

      <SettingsSection id="appearance-interface" title={gt("Interface")}>
        <SettingsRow
          {...searchableSetting("setting-appearance-contrast")}
          description={gt("Adjust the contrast of colors and borders across the interface.")}
          resetAction={
            settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast ? (
              <SettingResetButton
                ariaLabel={gt("Reset contrast to default")}
                onClick={() =>
                  updateSettings({
                    appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="appearance-contrast"
              >
                {settings.appearanceContrast}%
              </output>
              <input
                aria-label={gt("Contrast")}
                className="settings-slider min-w-0 flex-1"
                id="appearance-contrast"
                max={MAX_APPEARANCE_CONTRAST}
                min={MIN_APPEARANCE_CONTRAST}
                onChange={(event) => {
                  const appearanceContrast = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(appearanceContrast) &&
                    appearanceContrast >= MIN_APPEARANCE_CONTRAST &&
                    appearanceContrast <= MAX_APPEARANCE_CONTRAST
                  ) {
                    updateSettings({ appearanceContrast });
                  }
                }}
                step={5}
                style={appearanceContrastSliderStyle}
                type="range"
                value={settings.appearanceContrast}
              />
            </div>
          }
        />

        <SettingsRow
          {...searchableSetting("setting-glass-opacity")}
          description={gt("Higher values make menus, dialogs, and the composer more solid.")}
          resetAction={
            settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? (
              <SettingResetButton
                ariaLabel={gt("Reset glass opacity to default")}
                onClick={() =>
                  updateSettings({ glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="glass-opacity"
              >
                {settings.glassOpacity}%
              </output>
              <input
                aria-label={gt("Glass opacity")}
                className="settings-slider min-w-0 flex-1"
                id="glass-opacity"
                max={MAX_GLASS_OPACITY}
                min={MIN_GLASS_OPACITY}
                onChange={(event) => {
                  const glassOpacity = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(glassOpacity) &&
                    glassOpacity >= MIN_GLASS_OPACITY &&
                    glassOpacity <= MAX_GLASS_OPACITY
                  ) {
                    updateSettings({ glassOpacity });
                  }
                }}
                step={5}
                style={glassOpacitySliderStyle}
                type="range"
                value={settings.glassOpacity}
              />
            </div>
          }
        />

        <SettingsRow
          {...searchableSetting("sidebar-thread-rows")}
          description={gt(
            "How tall pinned and active threads are in the sidebar. Slim keeps the project icon, the title, the PR, a status icon and the time.",
          )}
          resetAction={
            settings.sidebarThreadRowDensity !==
            DEFAULT_UNIFIED_SETTINGS.sidebarThreadRowDensity ? (
              <SettingResetButton
                ariaLabel={gt("Reset thread rows to default")}
                onClick={() =>
                  updateSettings({
                    sidebarThreadRowDensity: DEFAULT_UNIFIED_SETTINGS.sidebarThreadRowDensity,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sidebarThreadRowDensity}
              onValueChange={(value) => {
                if (value === "comfortable" || value === "compact" || value === "slim") {
                  updateSettings({ sidebarThreadRowDensity: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={gt("Thread rows")}>
                <SelectValue>
                  {SIDEBAR_THREAD_ROW_DENSITY_LABELS[settings.sidebarThreadRowDensity]}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {Object.entries(SIDEBAR_THREAD_ROW_DENSITY_LABELS).map(([value, label]) => (
                  <SelectItem hideIndicator key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("sidebar-project-rows")}
          description={gt(
            "How roomy the project headers are when the sidebar is grouped by project. Comfortable adds a divider between projects.",
          )}
          resetAction={
            settings.sidebarProjectRowDensity !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectRowDensity ? (
              <SettingResetButton
                ariaLabel={gt("Reset project rows to default")}
                onClick={() =>
                  updateSettings({
                    sidebarProjectRowDensity: DEFAULT_UNIFIED_SETTINGS.sidebarProjectRowDensity,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sidebarProjectRowDensity}
              onValueChange={(value) => {
                if (value === "comfortable" || value === "compact" || value === "slim") {
                  updateSettings({ sidebarProjectRowDensity: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={gt("Project rows")}>
                <SelectValue>
                  {SIDEBAR_PROJECT_ROW_DENSITY_LABELS[settings.sidebarProjectRowDensity]}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {Object.entries(SIDEBAR_PROJECT_ROW_DENSITY_LABELS).map(([value, label]) => (
                  <SelectItem hideIndicator key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("sidebar-project-icons")}
          description={gt(
            "Show project icons. When grouped by project, this is the icon on each project header, and rows under a header leave it out.",
          )}
          resetAction={
            settings.sidebarProjectIcons !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectIcons ? (
              <SettingResetButton
                ariaLabel={gt("Reset project icons to default")}
                onClick={() =>
                  updateSettings({
                    sidebarProjectIcons: DEFAULT_UNIFIED_SETTINGS.sidebarProjectIcons,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.sidebarProjectIcons}
              onCheckedChange={(checked) =>
                updateSettings({ sidebarProjectIcons: Boolean(checked) })
              }
              aria-label={gt("Show project icons on thread rows")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("sidebar-project-icon-style")}
          description={gt(
            "Folder: headers are a folder in the project's colour, and rows without an icon show a folder. Initials: headers and rows show the project's icon or initials. Favicons and custom icons always stay.",
          )}
          resetAction={
            settings.sidebarProjectIconStyle !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectIconStyle ? (
              <SettingResetButton
                ariaLabel={gt("Reset project icon style to default")}
                onClick={() =>
                  updateSettings({
                    sidebarProjectIconStyle: DEFAULT_UNIFIED_SETTINGS.sidebarProjectIconStyle,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sidebarProjectIconStyle}
              onValueChange={(value) => {
                if (typeof value === "string" && value in SIDEBAR_PROJECT_ICON_STYLE_LABELS) {
                  updateSettings({
                    sidebarProjectIconStyle:
                      value as keyof typeof SIDEBAR_PROJECT_ICON_STYLE_LABELS,
                  });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={gt("Project icon style")}
              >
                <SelectValue>
                  {SIDEBAR_PROJECT_ICON_STYLE_LABELS[settings.sidebarProjectIconStyle]}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {Object.entries(SIDEBAR_PROJECT_ICON_STYLE_LABELS).map(([value, label]) => (
                  <SelectItem hideIndicator key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("sidebar-thread-indent")}
          description={gt(
            "How far threads sit in under their project header when the sidebar is grouped by project.",
          )}
          resetAction={
            settings.sidebarThreadIndent !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadIndent ? (
              <SettingResetButton
                ariaLabel={gt("Reset thread indent to default")}
                onClick={() =>
                  updateSettings({
                    sidebarThreadIndent: DEFAULT_UNIFIED_SETTINGS.sidebarThreadIndent,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sidebarThreadIndent}
              onValueChange={(value) => {
                if (typeof value === "string" && value in SIDEBAR_THREAD_INDENT_LABELS) {
                  updateSettings({
                    sidebarThreadIndent: value as keyof typeof SIDEBAR_THREAD_INDENT_LABELS,
                  });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={gt("Thread indent")}>
                <SelectValue>
                  {SIDEBAR_THREAD_INDENT_LABELS[settings.sidebarThreadIndent]}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {Object.entries(SIDEBAR_THREAD_INDENT_LABELS).map(([value, label]) => (
                  <SelectItem hideIndicator key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("sidebar-thread-emoji")}
          description={gt(
            "Thread rows show an emoji for their topic, read from the title, next to the project icon.",
          )}
          resetAction={
            settings.sidebarThreadEmoji !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadEmoji ? (
              <SettingResetButton
                ariaLabel={gt("Reset topic emoji to default")}
                onClick={() =>
                  updateSettings({
                    sidebarThreadEmoji: DEFAULT_UNIFIED_SETTINGS.sidebarThreadEmoji,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.sidebarThreadEmoji}
              onCheckedChange={(checked) =>
                updateSettings({ sidebarThreadEmoji: Boolean(checked) })
              }
              aria-label={gt("Show topic emoji on thread rows")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("sidebar-search-titles-only")}
          description={gt(
            "The sidebar search matches thread titles only, not message contents. A button beside the search box flips it while you search.",
          )}
          resetAction={
            settings.sidebarSearchTitlesOnly !==
            DEFAULT_UNIFIED_SETTINGS.sidebarSearchTitlesOnly ? (
              <SettingResetButton
                ariaLabel={gt("Reset search titles only to default")}
                onClick={() =>
                  updateSettings({
                    sidebarSearchTitlesOnly: DEFAULT_UNIFIED_SETTINGS.sidebarSearchTitlesOnly,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.sidebarSearchTitlesOnly}
              onCheckedChange={(checked) =>
                updateSettings({ sidebarSearchTitlesOnly: Boolean(checked) })
              }
              aria-label={gt("Search thread titles only")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("chat-width")}
          description={gt("Set how wide messages and the composer can grow on large screens.")}
          resetAction={
            settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ? (
              <SettingResetButton
                ariaLabel={gt("Reset chat width to default")}
                onClick={() => updateSettings({ chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth })}
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.chatWidth}
                onValueChange={(value) => {
                  if (value === "comfortable" || value === "wide" || value === "full")
                    updateSettings({ chatWidth: value });
                }}
              >
                <SelectTrigger size="sm" className="w-full min-w-0" aria-label={gt("Chat width")}>
                  <SelectValue>{m(CHAT_WIDTH_LABELS[settings.chatWidth])}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="comfortable">{gt("Comfortable (default)")}</SelectItem>
                  <SelectItem value="wide">{m(CHAT_WIDTH_LABELS.wide)}</SelectItem>
                  <SelectItem value="full">{m(CHAT_WIDTH_LABELS.full)}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("html-preview-width")}
          description={gt(
            "Let HTML previews in a chat grow wider than its messages, which stay centered.",
          )}
          resetAction={
            settings.htmlPreviewWidth !== DEFAULT_UNIFIED_SETTINGS.htmlPreviewWidth ? (
              <SettingResetButton
                ariaLabel={gt("Reset HTML preview width to default")}
                onClick={() =>
                  updateSettings({ htmlPreviewWidth: DEFAULT_UNIFIED_SETTINGS.htmlPreviewWidth })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.htmlPreviewWidth}
                onValueChange={(value) => {
                  if (value === "chat" || value === "wide" || value === "full")
                    updateSettings({ htmlPreviewWidth: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={gt("HTML preview width")}
                >
                  <SelectValue>
                    {m(HTML_PREVIEW_WIDTH_LABELS[settings.htmlPreviewWidth])}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="chat">{gt("Match chat (default)")}</SelectItem>
                  <SelectItem value="wide">{m(HTML_PREVIEW_WIDTH_LABELS.wide)}</SelectItem>
                  <SelectItem value="full">{m(HTML_PREVIEW_WIDTH_LABELS.full)}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <ThreadDetailsItemsRow />
        <SettingsRow
          {...searchableSetting("effort-display")}
          description={gt(
            "Show reasoning effort in the composer as its name, such as High, or as bars.",
          )}
          resetAction={
            settings.effortDisplay !== DEFAULT_UNIFIED_SETTINGS.effortDisplay ? (
              <SettingResetButton
                ariaLabel={gt("Reset effort display to default")}
                onClick={() =>
                  updateSettings({ effortDisplay: DEFAULT_UNIFIED_SETTINGS.effortDisplay })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.effortDisplay}
                onValueChange={(value) => {
                  if (value === "bars" || value === "label")
                    updateSettings({ effortDisplay: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={gt("Effort display")}
                >
                  <SelectValue>{m(EFFORT_DISPLAY_LABELS[settings.effortDisplay])}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="label">{gt("Word (default)")}</SelectItem>
                  <SelectItem value="bars">{m(EFFORT_DISPLAY_LABELS.bars)}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("math-rendering")}
          description={gt(
            "Typeset LaTeX math, such as $x^2$ or \\[x^2\\], in messages and Markdown previews. The composer keeps TeX source editable.",
          )}
          resetAction={
            settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled ? (
              <SettingResetButton
                ariaLabel={gt("Reset math rendering to default")}
                onClick={() =>
                  updateSettings({
                    mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.mathRenderingEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ mathRenderingEnabled: Boolean(checked) })
              }
              aria-label={gt("Render math")}
            />
          }
        />
        <AdvancedSettings
          targetIds={[
            searchableSetting("panel-animations").id,
            searchableSetting("environment-identification").id,
            // Environment identification's search result lands on this section.
            "appearance-interface",
            searchableSetting("composer-context").id,
          ]}
        >
          <SettingsRow
            {...searchableSetting("panel-animations")}
            description={gt("Set how fast panels open and close.")}
            control={
              <div className="grid w-full grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:w-auto sm:grid-cols-[7rem_13rem] sm:gap-4">
                <PanelAnimationsPreview durationMs={settings.panelAnimationDurationMs} />
                <div className="flex w-full items-center gap-3">
                  <output
                    className="min-w-16 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                    htmlFor="panel-animation-duration"
                  >
                    {settings.panelAnimationDurationMs} ms
                  </output>
                  <input
                    aria-label={gt("Panel animation duration")}
                    className="settings-slider min-w-0 flex-1"
                    id="panel-animation-duration"
                    max={MAX_PANEL_ANIMATION_DURATION_MS}
                    min={MIN_PANEL_ANIMATION_DURATION_MS}
                    onChange={(event) => {
                      const panelAnimationDurationMs = Number(event.currentTarget.value);
                      if (
                        Number.isInteger(panelAnimationDurationMs) &&
                        panelAnimationDurationMs >= MIN_PANEL_ANIMATION_DURATION_MS &&
                        panelAnimationDurationMs <= MAX_PANEL_ANIMATION_DURATION_MS
                      ) {
                        updateSettings({ panelAnimationDurationMs });
                      }
                    }}
                    step={25}
                    style={panelAnimationDurationSliderStyle}
                    type="range"
                    value={settings.panelAnimationDurationMs}
                  />
                </div>
              </div>
            }
            resetAction={
              settings.panelAnimationDurationMs !==
              DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs ? (
                <SettingResetButton
                  ariaLabel={gt("Reset panel animations to default")}
                  onClick={() =>
                    updateSettings({
                      panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
                    })
                  }
                />
              ) : null
            }
          />
          <SettingsRow
            {...searchableSetting("environment-identification")}
            description={environmentIdentificationDescription}
            resetAction={
              settings.environmentIdentificationMode !== DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE ? (
                <SettingResetButton
                  ariaLabel={gt("Reset environment identification to default")}
                  onClick={() =>
                    updateSettings({
                      environmentIdentificationMode: DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.environmentIdentificationMode}
                onValueChange={(value) => {
                  const option = environmentIdentificationOptionList.find(
                    ([optionValue]) => optionValue === value,
                  );
                  if (option) updateSettings({ environmentIdentificationMode: option[0] });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={gt("Environment identification")}
                >
                  <SelectValue>{environmentIdentificationLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {environmentIdentificationOptionList.map(([value, label]) => (
                    <SelectItem hideIndicator key={value} value={value}>
                      {m(label)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            {...searchableSetting("composer-context")}
            description={gt(
              "Keep branch and worktree controls below the composer after a thread starts.",
            )}
            resetAction={
              settings.persistComposerContextStrip !==
              DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip ? (
                <SettingResetButton
                  ariaLabel={gt("Reset composer context to default")}
                  onClick={() =>
                    updateSettings({
                      persistComposerContextStrip:
                        DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.persistComposerContextStrip}
                onCheckedChange={(checked) =>
                  updateSettings({ persistComposerContextStrip: Boolean(checked) })
                }
                aria-label={gt("Keep composer context visible in active threads")}
              />
            }
          />
        </AdvancedSettings>
      </SettingsSection>

      <TypographySection />
    </SettingsPageContainer>
  );
}
