import { PanelSection, PanelSectionRow, ToggleField } from "@decky/ui";
import { useEffect, useState } from "react";

import { KeepAwakeController, KeepAwakeState } from "../controller";

function useKeepAwakeState(controller: KeepAwakeController): KeepAwakeState {
  const [state, setState] = useState<KeepAwakeState>(() => controller.snapshot());
  useEffect(() => controller.subscribe(setState), [controller]);
  return state;
}

function Hint({ children }: { children: string }) {
  return (
    <div style={{ padding: "0 16px 8px", fontSize: "12px", opacity: 0.6 }}>{children}</div>
  );
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

  const { runningApp, apps, globalOverride, active } = state;
  const managed = Object.entries(apps).sort(([, a], [, b]) => a.localeCompare(b));
  const currentIsManaged = runningApp !== null && String(runningApp.appId) in apps;

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <ToggleField
            label="Keep awake now"
            description="Overrides everything below until you turn it off."
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
              description="Keep the screen awake whenever this is running."
              checked={currentIsManaged}
              onChange={(checked) =>
                controller.setAppEnabled(runningApp.appId, runningApp.name, checked)
              }
            />
          </PanelSectionRow>
        )}
      </PanelSection>

      {managed.length > 0 && (
        <PanelSection title="Keeping these awake">
          {managed.map(([appId, name]) => (
            <PanelSectionRow key={appId}>
              <ToggleField
                label={name}
                checked
                onChange={() => controller.setAppEnabled(Number(appId), name, false)}
              />
            </PanelSectionRow>
          ))}
        </PanelSection>
      )}

      <PanelSection>
        <Hint>
          {active
            ? "The screen will not dim and the Deck will not sleep."
            : "Steam's normal dim and sleep timers apply."}
        </Hint>
      </PanelSection>
    </>
  );
}
