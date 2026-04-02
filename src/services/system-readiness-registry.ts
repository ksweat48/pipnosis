/**
 * System Readiness Registry
 *
 * SSOT — Single authority for tracking boot-phase gate states.
 *
 * CCIP RATIONALE (CCIP-BOOT-ORDER-2026-04-02):
 * Before this service, boot ordering was enforced only by implicit code position
 * and ad-hoc polling loops (e.g., waitForInitialPriceData in goal-scanner.ts).
 * That pattern is fragile: any future service that needs to await readiness must
 * invent its own loop, creating N duplicate coordination mechanisms.
 *
 * This registry is the one canonical answer to "is the system ready to scan?".
 * Each participating service self-registers by calling markReady() or markFailed()
 * when it reaches its milestone.  Consumers call awaitReady([...gates]) which
 * returns a Promise that resolves only when every requested gate is ready.
 *
 * GOVERNANCE COMPLIANCE:
 * - SSOT: one registry owns boot state — no component re-implements it
 * - CCIP: all changes to gate semantics flow through this file
 * - Fail-loud: markFailed() surfaces named, structured errors
 * - Observable: emits structured boot log entries consumed by AlphaThoughtStream
 *
 * BOOT SEQUENCE CONTRACT (BOOT_ORDER):
 *   [1] price-poller   — PricePollingCoordinator first successful fetch
 *   [2] thesis-cache   — ThesisCacheWarmer.warmCache() completes (advisory only)
 *
 * Gates labeled as "advisory" do not block awaitReady(); they are tracked for
 * diagnostics only.  Hard gates (price-poller) DO block awaitReady().
 */

export type ReadinessGate =
  | 'price-poller'
  | 'thesis-cache';

export type GateState = 'pending' | 'ready' | 'failed';

export interface GateRecord {
  gate: ReadinessGate;
  state: GateState;
  markedAt: number | null;
  elapsedMs: number | null;
  failReason?: string;
}

export interface BootLogEntry {
  gate: ReadinessGate;
  state: GateState;
  elapsedMs: number | null;
  failReason?: string;
  timestamp: number;
}

const ADVISORY_GATES = new Set<ReadinessGate>(['thesis-cache']);
const HARD_GATES = new Set<ReadinessGate>(['price-poller']);

const DEFAULT_TIMEOUT_MS: Record<ReadinessGate, number> = {
  'price-poller': 8000,
  'thesis-cache': 15000,
};

class SystemReadinessRegistry {
  private readonly gates: Map<ReadinessGate, GateRecord> = new Map();
  private readonly bootLog: BootLogEntry[] = [];
  private readonly pendingWaiters: Map<ReadinessGate, Array<() => void>> = new Map();
  private readonly startedAt: number = Date.now();

  constructor() {
    const allGates: ReadinessGate[] = ['price-poller', 'thesis-cache'];
    for (const gate of allGates) {
      this.gates.set(gate, { gate, state: 'pending', markedAt: null, elapsedMs: null });
      this.pendingWaiters.set(gate, []);
    }
  }

  markReady(gate: ReadinessGate): void {
    const record = this.gates.get(gate);
    if (!record) return;

    if (record.state === 'ready') return;

    const elapsedMs = Date.now() - this.startedAt;
    record.state = 'ready';
    record.markedAt = Date.now();
    record.elapsedMs = elapsedMs;

    const entry: BootLogEntry = {
      gate,
      state: 'ready',
      elapsedMs,
      timestamp: Date.now(),
    };
    this.bootLog.push(entry);

    console.log(`[SystemReadiness] ✅ Gate ready: ${gate} (+${elapsedMs}ms)`);

    this.resolveWaiters(gate);
    this.checkAllReady();
  }

  markFailed(gate: ReadinessGate, reason: string): void {
    const record = this.gates.get(gate);
    if (!record) return;

    const elapsedMs = Date.now() - this.startedAt;
    record.state = 'failed';
    record.markedAt = Date.now();
    record.elapsedMs = elapsedMs;
    record.failReason = reason;

    const entry: BootLogEntry = {
      gate,
      state: 'failed',
      elapsedMs,
      failReason: reason,
      timestamp: Date.now(),
    };
    this.bootLog.push(entry);

    console.warn(`[SystemReadiness] ⚠️ Gate failed: ${gate} — ${reason} (+${elapsedMs}ms)`);

    if (ADVISORY_GATES.has(gate)) {
      this.resolveWaiters(gate);
    }
  }

  isReady(gate: ReadinessGate): boolean {
    return this.gates.get(gate)?.state === 'ready';
  }

  getState(gate: ReadinessGate): GateState {
    return this.gates.get(gate)?.state ?? 'pending';
  }

  /**
   * Await one or more gates becoming ready (or failed for advisory gates).
   * Rejects with a structured error if any HARD gate fails or times out.
   */
  async awaitReady(gates: ReadinessGate[]): Promise<void> {
    const waits = gates.map(gate => this.awaitSingleGate(gate));
    await Promise.all(waits);
  }

  private awaitSingleGate(gate: ReadinessGate): Promise<void> {
    const record = this.gates.get(gate);
    if (!record) return Promise.resolve();

    if (record.state === 'ready') return Promise.resolve();

    if (record.state === 'failed') {
      if (ADVISORY_GATES.has(gate)) return Promise.resolve();
      return Promise.reject(
        new Error(`[SystemReadiness] Hard gate failed at boot: ${gate} — ${record.failReason}`)
      );
    }

    const timeoutMs = DEFAULT_TIMEOUT_MS[gate] ?? 8000;

    return new Promise<void>((resolve, reject) => {
      const waiters = this.pendingWaiters.get(gate)!;

      let settled = false;

      const done = () => {
        if (settled) return;
        settled = true;

        const r = this.gates.get(gate)!;
        if (r.state === 'ready') {
          resolve();
        } else if (r.state === 'failed') {
          if (ADVISORY_GATES.has(gate)) {
            resolve();
          } else {
            reject(new Error(`[SystemReadiness] Hard gate failed: ${gate} — ${r.failReason}`));
          }
        } else {
          if (HARD_GATES.has(gate)) {
            console.warn(
              `[SystemReadiness] Hard gate timed out after ${timeoutMs}ms: ${gate} — proceeding with degraded boot`
            );
          }
          resolve();
        }
      };

      waiters.push(done);

      setTimeout(() => {
        const idx = waiters.indexOf(done);
        if (idx !== -1) waiters.splice(idx, 1);
        done();
      }, timeoutMs);
    });
  }

  private resolveWaiters(gate: ReadinessGate): void {
    const waiters = this.pendingWaiters.get(gate) ?? [];
    const copy = [...waiters];
    waiters.length = 0;
    for (const fn of copy) fn();
  }

  private checkAllReady(): void {
    const hardGatesDone = [...HARD_GATES].every(g => {
      const s = this.gates.get(g)?.state;
      return s === 'ready' || s === 'failed';
    });

    if (hardGatesDone) {
      const elapsed = Date.now() - this.startedAt;
      const summary = [...this.gates.values()]
        .map(r => `${r.gate}=${r.state}(${r.elapsedMs ?? '?'}ms)`)
        .join(', ');
      console.log(`[SystemReadiness] 🚀 SYSTEM READY — ${elapsed}ms total. Gates: [${summary}]`);
    }
  }

  getBootLog(): BootLogEntry[] {
    return [...this.bootLog];
  }

  getDiagnostics(): GateRecord[] {
    return [...this.gates.values()].map(r => ({ ...r }));
  }
}

export const systemReadinessRegistry = new SystemReadinessRegistry();
