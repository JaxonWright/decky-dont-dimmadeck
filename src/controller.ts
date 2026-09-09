import { Config, DEFAULT_CONFIG, loadConfig, saveConfig } from "./config";
import { RunningApp, watchRunningApp } from "./steam/apps";
import {
  IdleTimeouts,
  NEVER,
  STEAM_DEFAULTS,
  applyIdleTimeouts,
  timeoutsEqual,
  watchIdleTimeouts,
} from "./steam/idle";

export interface KeepAwakeState {
  ready: boolean;
  /** The app in the foreground, or null on the library. */
  runningApp: RunningApp | null;
  /** App ID to display name, for every app the user has enabled. */
  apps: Record<string, string>;
  globalOverride: boolean;
  /** Whether Steam's idle timers are currently overridden. */
  active: boolean;
}

type Listener = (state: KeepAwakeState) => void;

/** How long to wait for Steam to report its current timeouts before giving up. */
const OBSERVE_TIMEOUT_MS = 2000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Owns the decision of whether Steam's idle timers should be overridden, and
 * owns the user's original values while they are.
 *
 * The rule is simply: override while the global toggle is on, or while the
 * foreground app is one the user has enabled.
 */
export class KeepAwakeController {
  private config: Config = { ...DEFAULT_CONFIG };
  private runningApp: RunningApp | null = null;
  private ready = false;
  private active = false;

  /** Steam's own timeouts, tracked while we are not overriding them. */
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
        if (partial.dimBattery !== undefined || partial.dimAc !== undefined) {
          this.pendingHalves.delete("dim");
        }
        if (partial.suspendBattery !== undefined || partial.suspendAc !== undefined) {
          this.pendingHalves.delete("suspend");
        }
        if (this.pendingHalves.size === 0) this.markObserved();

        // While overriding, these updates are just our own zeroes echoing back.
        if (this.active) return;
        this.observed = { ...this.observed, ...partial };
      }),
    );

    this.unsubscribers.push(
      watchRunningApp((app) => {
        this.runningApp = app;
        this.emit();
        void this.reconcile();
      }),
    );

    this.config = await loadConfig();

    // A previous session was killed mid-override - Steam kept the zeroes, so
    // put the user's timeouts back before doing anything else.
    if (this.config.inhibitActive) {
      const baseline = this.config.baseline ?? STEAM_DEFAULTS;
      console.warn("[Don't Dimmadeck] restoring idle timeouts left over from a previous session");
      this.observed = baseline;
      this.active = true;
    }

    // Steam reports its current settings shortly after we subscribe. Overriding
    // before that lands would snapshot our fallback defaults as the baseline and
    // lose whatever the user actually had configured, so give it a moment - but
    // not forever, in case this Steam build never sends them.
    if (!this.config.inhibitActive) {
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
    if (this.active) {
      // Best effort: decky does not wait on onDismount, so this is fire and
      // forget. The inhibitActive flag covers us if it does not land.
      void this.restore();
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
      globalOverride: this.config.globalOverride,
      active: this.active,
    };
  }

  setGlobalOverride(enabled: boolean): void {
    this.config = { ...this.config, globalOverride: enabled };
    this.emit();
    void this.persist();
    void this.reconcile();
  }

  setAppEnabled(appId: number, name: string, enabled: boolean): void {
    const apps = { ...this.config.apps };
    if (enabled) {
      apps[String(appId)] = name;
    } else {
      delete apps[String(appId)];
    }
    this.config = { ...this.config, apps };
    this.emit();
    void this.persist();
    void this.reconcile();
  }

  isAppEnabled(appId: number): boolean {
    return String(appId) in this.config.apps;
  }

  private shouldKeepAwake(): boolean {
    if (this.config.globalOverride) return true;
    return this.runningApp !== null && this.isAppEnabled(this.runningApp.appId);
  }

  /** Brings Steam's timers in line with what the current state calls for. */
  private reconcile(): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (!this.ready) return;
      const wanted = this.shouldKeepAwake();
      if (wanted === this.active) return;
      await (wanted ? this.override() : this.restore());
      this.emit();
    });
    return this.queue;
  }

  private async override(): Promise<void> {
    // Snapshot before overriding, so restore has somewhere to go back to.
    this.config = { ...this.config, baseline: this.observed, inhibitActive: true };
    this.active = true;
    await this.persist();
    await applyIdleTimeouts(NEVER);
  }

  private async restore(): Promise<void> {
    const baseline = this.config.baseline ?? STEAM_DEFAULTS;
    // Restoring zeroes would defeat the point; if that is genuinely what the
    // user had set, Steam's defaults are the safer answer.
    const target = timeoutsEqual(baseline, NEVER) ? STEAM_DEFAULTS : baseline;
    this.active = false;
    this.observed = target;
    this.config = { ...this.config, inhibitActive: false };
    await applyIdleTimeouts(target);
    await this.persist();
  }

  private persist(): Promise<void> {
    return saveConfig(this.config);
  }

  private emit(): void {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }
}
