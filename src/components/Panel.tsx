import { ButtonItem, DropdownItem, PanelSection, PanelSectionRow, ToggleField } from "@decky/ui";
import { useEffect, useState } from "react";

import { DEFAULT_PROFILE, POWER_CONDITIONS, POWER_CONDITION_LABELS, profileIsNoop } from "../profile";

import type { KeepAwakeController, KeepAwakeState } from "../controller";
import type { PowerCondition, Profile } from "../profile";

function useKeepAwakeState(controller: KeepAwakeController): KeepAwakeState {
  const [state, setState] = useState<KeepAwakeState>(() => controller.snapshot());
  useEffect(() => controller.subscribe(setState), [controller]);
  return state;
}

function Hint({ children }: { children: string }) {
  return <div style={{ padding: "0 16px 8px", fontSize: "12px", opacity: 0.6 }}>{children}</div>;
}

const CONDITION_OPTIONS = POWER_CONDITIONS.map((condition) => ({
  data: condition,
  label: POWER_CONDITION_LABELS[condition],
}));

/** The three settings that make up a profile, used for defaults and per-app alike. */
function ProfileFields({
  profile,
  onChange,
}: {
  profile: Profile;
  onChange: (profile: Profile) => void;
}) {
  return (
    <>
      <PanelSectionRow>
        <ToggleField
          label="Prevent dimming"
          checked={profile.preventDimming}
          onChange={(checked) => onChange({ ...profile, preventDimming: checked })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Prevent sleep"
          checked={profile.preventSleep}
          onChange={(checked) => onChange({ ...profile, preventSleep: checked })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <DropdownItem
          label="Only apply when"
          rgOptions={CONDITION_OPTIONS}
          selectedOption={profile.condition}
          onChange={(option) => onChange({ ...profile, condition: option.data as PowerCondition })}
        />
      </PanelSectionRow>
      {profileIsNoop(profile) && (
        <Hint>Both settings are off, so this will not change anything.</Hint>
      )}
    </>
  );
}

/** Per-app settings for whichever app is selected in the dropdown. */
function PerAppSection({
  controller,
  state,
}: {
  controller: KeepAwakeController;
  state: KeepAwakeState;
}) {
  const appIds = Object.keys(state.apps);
  const [selected, setSelected] = useState<string | null>(null);

  // Follow the running app when it is managed, and never point at an app that
  // has since been removed.
  const running = state.runningApp && String(state.runningApp.appId);
  const fallback = running && state.apps[running] ? running : (appIds[0] ?? null);
  const appId = selected && state.apps[selected] ? selected : fallback;

  if (appIds.length === 0 || appId === null) return null;

  const app = state.apps[appId];
  const custom = app.profile !== null;
  const profile = app.profile ?? state.defaults;

  return (
    <PanelSection title="Per-app settings">
      {appIds.length > 1 && (
        <PanelSectionRow>
          <DropdownItem
            label="App"
            rgOptions={Object.entries(state.apps)
              .sort(([, a], [, b]) => a.name.localeCompare(b.name))
              .map(([id, entry]) => ({ data: id, label: entry.name }))}
            selectedOption={appId}
            onChange={(option) => setSelected(option.data as string)}
          />
        </PanelSectionRow>
      )}

      <PanelSectionRow>
        <ToggleField
          label="Use custom settings"
          description={custom ? undefined : "Currently following the defaults below."}
          checked={custom}
          onChange={(checked) =>
            controller.setAppProfile(Number(appId), checked ? { ...profile } : null)
          }
        />
      </PanelSectionRow>

      {custom && (
        <ProfileFields
          profile={profile}
          onChange={(next) => controller.setAppProfile(Number(appId), next)}
        />
      )}

      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={() => controller.setAppEnabled(Number(appId), app.name, false)}
        >
          {`Stop keeping ${app.name} awake`}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

function statusText(state: KeepAwakeState): string {
  const { dim, suspend } = state.overridden;
  if (dim && suspend) return "The screen will not dim and the Deck will not sleep.";
  if (dim) return "The screen will not dim. Sleep is on Steam's normal timer.";
  if (suspend) return "The Deck will not sleep. Dimming is on Steam's normal timer.";
  return "Steam's normal dim and sleep timers apply.";
}

export function Panel({ controller }: { controller: KeepAwakeController }) {
  const state = useKeepAwakeState(controller);

  if (!state.ready) {
    return (
      <PanelSection>
        <Hint>Loading…</Hint>
      </PanelSection>
    );
  }

  const { runningApp, apps, defaults, globalOverride } = state;
  const currentIsManaged = runningApp !== null && String(runningApp.appId) in apps;

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <ToggleField
            label="Keep awake now"
            description="Applies the defaults straight away, ignoring the power conditions."
            checked={globalOverride}
            onChange={(checked) => controller.setGlobalOverride(checked)}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Current game">
        {runningApp === null ? (
          <Hint>Nothing is running. Launch a game to add it to the list.</Hint>
        ) : (
          <PanelSectionRow>
            <ToggleField
              label={runningApp.name}
              description="Keep this awake whenever it is running."
              checked={currentIsManaged}
              onChange={(checked) =>
                controller.setAppEnabled(runningApp.appId, runningApp.name, checked)
              }
            />
          </PanelSectionRow>
        )}
      </PanelSection>

      <PerAppSection controller={controller} state={state} />

      <PanelSection title="Defaults">
        <ProfileFields
          profile={defaults ?? DEFAULT_PROFILE}
          onChange={(next) => controller.setDefaults(next)}
        />
      </PanelSection>

      <PanelSection>
        <Hint>{statusText(state)}</Hint>
      </PanelSection>
    </>
  );
}
