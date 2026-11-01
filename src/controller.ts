import { defaultConfig, loadConfig, saveConfig } from "./config";
import { DEFAULT_PROFILE, conditionMet } from "./profile";
import { watchRunningApp } from "./steam/apps";
import {
  IDLE_PARTS,
  NEVER,
  NO_PARTS,
  PART_KEYS,
  STEAM_DEFAULTS,
  anyPart,
  applyIdleTimeouts,
  partsEqual,
  partsIn,
  restoreTarget,
  watchIdleTimeouts,
} from "./steam/idle";
import { watchPowerState } from "./steam/power";

import type { Config, ManagedApp } from "./config";
import type { PowerState, Profile } from "./profile";
import type { RunningApp } from "./steam/apps";
import type { IdlePart, IdleParts, IdleTimeouts } from "./steam/idle";

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
 * Dimming, the screensaver and sleep are tracked separately throughout: a
 * profile may prevent any one without the others, so the three halves are
 * snapshotted, applied and restored independently. Writing a half we are not
 * changing would clobber a setting the user asked us to leave alone.
 */
export class KeepAwakeController {
  private config: Config = defaultConfig();
  private runningApp: RunningApp | null = null;
  private power: PowerState = { onAc: false, externalDisplay: false };
  private ready = false;
  private disposed = false;

  /** Which halves we are currently holding at zero. */
  private overridden: IdleParts = { ...NO_PARTS };

  /** Steam's own timeouts, tracked per half while we are not overriding it. */
  private observed: IdleTimeouts = { ...STEAM_DEFAULTS };

  private listeners = new Set<Listener>();
  private unsubscribers: Array<() => void> = [];
  /** Serialises the apply/restore work so overlapping events cannot interleave. */
  private queue: Promise<void> = Promise.resolve();

  /** Resolves once Steam has reported every half of its idle settings. */
  private observedReady!: Promise<void>;
  private markObserved!: () => void;
  private pendingHalves = new Set<IdlePart>(IDLE_PARTS);

  async init(): Promise<void> {
    if (this.disposed) return;

    this.observedReady = new Promise<void>((resolve) => {
      this.markObserved = resolve;
    });

    this.unsubscribers.push(
      watchIdleTimeouts((partial, covered) => {
        // A message speaks for every half its source covers, present or not:
        // a Steam build without a field never sends it, so it would otherwise
        // stay pending until the timeout on every single load.
        for (const part of covered) this.pendingHalves.delete(part);
        const seen = partsIn(partial);
        for (const part of IDLE_PARTS) {
          if (!seen[part]) continue;
          // For a half we are overriding, these updates are our own zeroes
          // echoing back; for the others they are the user's real settings.
          if (this.overridden[part]) continue;
          for (const key of PART_KEYS[part]) {
            const value = partial[key];
            if (value !== undefined) this.observed[key] = value;
          }
        }
        if (this.pendingHalves.size === 0) this.markObserved();
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
    if (this.abandonInit()) return;

    // A previous session was killed mid-override - Steam kept the zeroes, so
    // the halves it was holding have to be put back. Only those halves take
    // their values from the stored baseline: for the others Steam is still
    // the authority, and a baseline migrated from an older config carries
    // defaults, not observations, for halves that config never knew about.
    if (anyPart(this.config.overridden)) {
      console.warn("[Don't Dimmadeck] restoring idle timeouts left over from a previous session");
      this.overridden = { ...this.config.overridden };
      const baseline = this.config.baseline ?? STEAM_DEFAULTS;
      for (const part of IDLE_PARTS) {
        if (!this.overridden[part]) continue;
        for (const key of PART_KEYS[part]) this.observed[key] = baseline[key];
        // Steam would only echo our own zeroes back for these.
        this.pendingHalves.delete(part);
      }
      if (this.pendingHalves.size === 0) this.markObserved();
    }

    // Steam reports its current settings shortly after we subscribe.
    // Overriding before that lands would snapshot our fallback defaults as
    // the baseline and lose whatever the user actually had configured, so
    // give it a moment - but not forever, in case it never arrives.
    await Promise.race([this.observedReady, sleep(OBSERVE_TIMEOUT_MS)]);
    if (this.abandonInit()) return;
    if (this.pendingHalves.size > 0) {
      console.warn(
        "[Don't Dimmadeck] Steam did not report its idle timeouts; " +
          `assuming defaults for ${[...this.pendingHalves].join(", ")}`,
      );
    }

    this.ready = true;
    this.emit();
    await this.reconcile();
  }

  /**
   * True when dispose landed mid-init. Initialisation must stop there rather
   * than go on to set `ready` and reconcile, which would re-apply an override
   * after the plugin had already been unloaded.
   */
  private abandonInit(): boolean {
    if (!this.disposed) return false;
    this.unsubscribeAll();
    return true;
  }

  private unsubscribeAll(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    this.unsubscribeAll();
    this.listeners.clear();
    if (anyPart(this.overridden)) {
      // Queued rather than called directly, so an override still in flight
      // cannot finish after the restore and leave the timers at zero. decky
      // does not await onDismount, so this is best effort either way; the
      // persisted flags are what actually guarantee recovery.
      this.queue = this.queue.then(() => this.applyParts({ ...NO_PARTS }));
      void this.queue;
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
    return {
      dim: profile.preventDimming,
      suspend: profile.preventSleep,
      screensaver: profile.preventScreensaver,
    };
  }

  private reconcile(): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (!this.ready || this.disposed) return;
      const wanted = this.wantedParts();
      if (partsEqual(wanted, this.overridden)) return;
      await this.applyParts(wanted);
      this.emit();
    });
    return this.queue;
  }

  /**
   * Moves to a new set of overridden halves.
   *
   * Restores go first and unconditionally, because putting a value back is
   * always safe. Takeovers wait for the config write that records them: that
   * record is the only thing that can return the timers after an unclean
   * shutdown, so disabling a timer we failed to write down would be the one
   * way to strand the screen permanently undimmed.
   *
   * Over-recording is the safe direction. A half marked held that is not
   * actually held only costs a redundant restore next load; a half held but
   * not recorded never comes back.
   */
  private async applyParts(wanted: IdleParts): Promise<void> {
    const held = { ...this.overridden };
    const baseline = { ...(this.config.baseline ?? STEAM_DEFAULTS) };

    const handingBack = { ...NO_PARTS };
    const takingOver = { ...NO_PARTS };
    for (const part of IDLE_PARTS) {
      handingBack[part] = !wanted[part] && held[part];
      takingOver[part] = wanted[part] && !held[part];
    }

    if (anyPart(handingBack)) {
      const target = restoreTarget(baseline);
      const restored = await applyIdleTimeouts(target, handingBack);
      // Only a half that actually landed stops being owed back.
      for (const part of IDLE_PARTS) {
        if (!restored[part]) continue;
        for (const key of PART_KEYS[part]) this.observed[key] = target[key];
        held[part] = false;
      }
      this.overridden = { ...held };
      this.config = { ...this.config, overridden: { ...held } };
      await this.persist();
    }

    if (!anyPart(takingOver)) return;

    const intended = { ...NO_PARTS };
    for (const part of IDLE_PARTS) {
      if (takingOver[part]) {
        for (const key of PART_KEYS[part]) baseline[key] = this.observed[key];
      }
      intended[part] = held[part] || takingOver[part];
    }

    const previousConfig = this.config;
    this.config = { ...this.config, baseline, overridden: { ...intended } };

    if (!(await this.persist())) {
      console.error(
        "[Don't Dimmadeck] leaving the idle timers alone: the config write failed, " +
          "so there would be nothing to restore them from",
      );
      this.config = previousConfig;
      this.overridden = { ...held };
      return;
    }

    const applied = await applyIdleTimeouts(NEVER, takingOver);
    for (const part of IDLE_PARTS) held[part] = held[part] || applied[part];
    this.overridden = { ...held };

    if (!partsEqual(held, intended)) {
      // A setter failed, so narrow the record to what is really held.
      this.config = { ...this.config, overridden: { ...held } };
      await this.persist();
    }
  }

  /** Returns whether the write landed. */
  private persist(): Promise<boolean> {
    return saveConfig(this.config);
  }

  private emit(): void {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }
}

export { DEFAULT_PROFILE };
