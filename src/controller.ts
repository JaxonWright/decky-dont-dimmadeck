import { defaultConfig, loadConfig, saveConfig } from "./config";
import { DEFAULT_PROFILE, conditionMet } from "./profile";
import { watchRunningApp } from "./steam/apps";
import {
  NO_PARTS,
  STEAM_DEFAULTS,
  anyPart,
  applyIdleTimeouts,
  partsEqual,
  watchIdleTimeouts,
} from "./steam/idle";
import { watchPowerState } from "./steam/power";

import type { Config, ManagedApp } from "./config";
import type { PowerState, Profile } from "./profile";
import type { RunningApp } from "./steam/apps";
import type { IdleParts, IdleTimeouts } from "./steam/idle";

export interface KeepAwakeState {
  ready: boolean;
  /** The app in the foreground, or null on the library. */
  runningApp: RunningApp | null;
  apps: Record<string, ManagedApp>;
  defaults: Profile;
  globalOverride: boolean;
  power: PowerState;
  /** Which halves of Steam's timers are currently overridden. */
  overridden: IdleParts;
}

type Listener = (state: KeepAwakeState) => void;

/** How long to wait for Steam to report its current timeouts before giving up. */
const OBSERVE_TIMEOUT_MS = 2000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Owns the decision of which of Steam's idle timers should be overridden, and
 * owns the user's original values while they are.
 *
 * Dimming and sleep are tracked separately throughout: a profile may prevent
 * one without the other, so the two halves are snapshotted, applied and
 * restored independently. Writing a half we are not changing would clobber a
 * setting the user asked us to leave alone.
 */
export class KeepAwakeController {
  private config: Config = defaultConfig();
  private runningApp: RunningApp | null = null;
  private power: PowerState = { onAc: false, externalDisplay: false };
  private ready = false;

  /** Which halves we are currently holding at zero. */
  private overridden: IdleParts = { ...NO_PARTS };

  /** Steam's own timeouts, tracked per half while we are not overriding it. */
  private observed: IdleTimeouts = { ...STEAM_DEFAULTS };

  private listeners = new Set<Listener>();
  private unsubscribers: Array<() => void> = [];
  /** Serialises the apply/restore work so overlapping events cannot interleave. */
  private queue: Promise<void> = Promise.resolve();

  /** Resolves once Steam has reported both halves of its idle settings. */
  private observedReady!: Promise<void>;
  private markObserved!: () => void;
  private pendingHalves = new Set(["dim", "suspend"]);

  async init(): Promise<void> {
    this.observedReady = new Promise<void>((resolve) => {
      this.markObserved = resolve;
    });

    this.unsubscribers.push(
      watchIdleTimeouts((partial) => {
        const sawDim = partial.dimBattery !== undefined || partial.dimAc !== undefined;
        const sawSuspend = partial.suspendBattery !== undefined || partial.suspendAc !== undefined;
        if (sawDim) this.pendingHalves.delete("dim");
        if (sawSuspend) this.pendingHalves.delete("suspend");
        if (this.pendingHalves.size === 0) this.markObserved();

        // For a half we are overriding, these updates are our own zeroes
        // echoing back; for the other half they are the user's real settings.
        if (sawDim && !this.overridden.dim) {
          if (partial.dimBattery !== undefined) this.observed.dimBattery = partial.dimBattery;
          if (partial.dimAc !== undefined) this.observed.dimAc = partial.dimAc;
        }
        if (sawSuspend && !this.overridden.suspend) {
          if (partial.suspendBattery !== undefined) {
            this.observed.suspendBattery = partial.suspendBattery;
          }
          if (partial.suspendAc !== undefined) this.observed.suspendAc = partial.suspendAc;
        }
      }),
    );

    this.unsubscribers.push(
      watchRunningApp((app) => {
        this.runningApp = app;
        this.emit();
        void this.reconcile();
      }),
    );

    this.unsubscribers.push(
      watchPowerState((power) => {
        this.power = power;
        this.emit();
        void this.reconcile();
      }),
    );

    this.config = await loadConfig();

    // A previous session was killed mid-override - Steam kept the zeroes, so
    // the halves it was holding have to be put back.
    if (anyPart(this.config.overridden)) {
      console.warn("[Don't Dimmadeck] restoring idle timeouts left over from a previous session");
      this.overridden = { ...this.config.overridden };
      this.observed = { ...this.observed, ...(this.config.baseline ?? STEAM_DEFAULTS) };
    } else {
      // Steam reports its current settings shortly after we subscribe.
      // Overriding before that lands would snapshot our fallback defaults as
      // the baseline and lose whatever the user actually had configured, so
      // give it a moment - but not forever, in case it never arrives.
      await Promise.race([this.observedReady, sleep(OBSERVE_TIMEOUT_MS)]);
      if (this.pendingHalves.size > 0) {
        console.warn(
          "[Don't Dimmadeck] Steam did not report its idle timeouts; " +
            `assuming defaults for ${[...this.pendingHalves].join(" and ")}`,
        );
      }
    }

    this.ready = true;
    this.emit();
    await this.reconcile();
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.listeners.clear();
    if (anyPart(this.overridden)) {
      // Best effort: decky does not wait on onDismount, so this is fire and
      // forget. The persisted overridden flags cover us if it does not land.
      void this.applyParts({ ...NO_PARTS });
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): KeepAwakeState {
    return {
      ready: this.ready,
      runningApp: this.runningApp,
      apps: { ...this.config.apps },
      defaults: { ...this.config.defaults },
      globalOverride: this.config.globalOverride,
      power: { ...this.power },
      overridden: { ...this.overridden },
    };
  }

  setGlobalOverride(enabled: boolean): void {
    this.update({ globalOverride: enabled });
  }

  setDefaults(defaults: Profile): void {
    this.update({ defaults });
  }

  setAppEnabled(appId: number, name: string, enabled: boolean): void {
    const apps = { ...this.config.apps };
    if (enabled) {
      apps[String(appId)] = { name, profile: apps[String(appId)]?.profile ?? null };
    } else {
      delete apps[String(appId)];
    }
    this.update({ apps });
  }

  /** Sets an app's own profile, or null to follow the defaults. */
  setAppProfile(appId: number, profile: Profile | null): void {
    const existing = this.config.apps[String(appId)];
    if (!existing) return;
    this.update({ apps: { ...this.config.apps, [String(appId)]: { ...existing, profile } } });
  }

  isAppEnabled(appId: number): boolean {
    return String(appId) in this.config.apps;
  }

  private update(patch: Partial<Config>): void {
    this.config = { ...this.config, ...patch };
    this.emit();
    void this.persist();
    void this.reconcile();
  }

  /** The profile in force right now, or null if nothing should be overridden. */
  private activeProfile(): Profile | null {
    if (this.config.globalOverride) {
      // A manual override is an explicit "keep awake now", so it ignores the
      // power conditions - the user is looking straight at the toggle.
      return { ...this.config.defaults, condition: "always" };
    }

    const app = this.runningApp && this.config.apps[String(this.runningApp.appId)];
    if (!app) return null;

    return app.profile ?? this.config.defaults;
  }

  /** Which halves the current state calls for. */
  private wantedParts(): IdleParts {
    const profile = this.activeProfile();
    if (!profile) return { ...NO_PARTS };
    if (!conditionMet(profile.condition, this.power)) return { ...NO_PARTS };
    return { dim: profile.preventDimming, suspend: profile.preventSleep };
  }

  private reconcile(): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (!this.ready) return;
      const wanted = this.wantedParts();
      if (partsEqual(wanted, this.overridden)) return;
      await this.applyParts(wanted);
      this.emit();
    });
    return this.queue;
  }

  /**
   * Moves to a new set of overridden halves, snapshotting each one before
   * taking it over and restoring it as it is handed back.
   */
  private async applyParts(wanted: IdleParts): Promise<void> {
    const baseline = { ...(this.config.baseline ?? STEAM_DEFAULTS) };

    const takingOver: IdleParts = {
      dim: wanted.dim && !this.overridden.dim,
      suspend: wanted.suspend && !this.overridden.suspend,
    };
    const handingBack: IdleParts = {
      dim: !wanted.dim && this.overridden.dim,
      suspend: !wanted.suspend && this.overridden.suspend,
    };

    // Snapshot the halves being taken over, so restore has somewhere to go
    // back to. A half already held keeps the baseline it was given.
    if (takingOver.dim) {
      baseline.dimBattery = this.observed.dimBattery;
      baseline.dimAc = this.observed.dimAc;
    }
    if (takingOver.suspend) {
      baseline.suspendBattery = this.observed.suspendBattery;
      baseline.suspendAc = this.observed.suspendAc;
    }

    this.overridden = { ...wanted };
    this.config = { ...this.config, baseline, overridden: { ...wanted } };
    await this.persist();

    if (anyPart(takingOver)) {
      const zeroes: IdleTimeouts = { dimBattery: 0, dimAc: 0, suspendBattery: 0, suspendAc: 0 };
      await applyIdleTimeouts(zeroes, takingOver);
    }

    if (anyPart(handingBack)) {
      // Restoring a zero would defeat the point; if that is genuinely what the
      // user had, Steam's defaults are the safer answer.
      const target: IdleTimeouts = {
        dimBattery: baseline.dimBattery || STEAM_DEFAULTS.dimBattery,
        dimAc: baseline.dimAc || STEAM_DEFAULTS.dimAc,
        suspendBattery: baseline.suspendBattery || STEAM_DEFAULTS.suspendBattery,
        suspendAc: baseline.suspendAc || STEAM_DEFAULTS.suspendAc,
      };
      if (handingBack.dim) {
        this.observed.dimBattery = target.dimBattery;
        this.observed.dimAc = target.dimAc;
      }
      if (handingBack.suspend) {
        this.observed.suspendBattery = target.suspendBattery;
        this.observed.suspendAc = target.suspendAc;
      }
      await applyIdleTimeouts(target, handingBack);
    }
  }

  private persist(): Promise<void> {
    return saveConfig(this.config);
  }

  private emit(): void {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }
}

export { DEFAULT_PROFILE };
