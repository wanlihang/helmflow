import { EventEmitter } from "node:events";
import type { OrchestratorEvent } from "./types";

const emitters = new Map<string, EventEmitter>();

/**
 * Maximum number of events kept in the rolling replay buffer.
 * When a new SSE client connects (e.g. user reopens the browser),
 * the entire buffer is replayed so no recent events are missed.
 */
const MAX_BUFFER = 200;

/** Cleanup delay (ms) — remove emitter from map after run ends. */
const CLEANUP_DELAY_MS = 30_000;

export function createRunEmitter(runId: string): EventEmitter {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);

  // Rolling buffer: always keep the most recent events, regardless of
  // whether a listener is attached.  This ensures that when a client
  // disconnects and reconnects later, it can receive everything that
  // happened while it was away (up to MAX_BUFFER events).
  const buffer: OrchestratorEvent[] = [];
  const origEmit = emitter.emit.bind(emitter);
  const origOn = emitter.on.bind(emitter);
  const origOnce = emitter.once.bind(emitter);

  // Track the set of listeners that have already received the buffer
  // replay so that removing and re-adding the same listener function
  // does NOT cause duplicate delivery.
  const replayedListeners = new WeakSet<(...args: unknown[]) => void>();

  // --- Override emit: push into rolling buffer unconditionally -----------
  emitter.emit = (eventName: string | symbol, ...args: unknown[]): boolean => {
    if (eventName === "event") {
      buffer.push(args[0] as OrchestratorEvent);
      if (buffer.length > MAX_BUFFER) {
        buffer.splice(0, buffer.length - MAX_BUFFER);
      }
      // Stash buffer size for diagnostics
      (emitter as unknown as Record<symbol, number>)[BUFFER_SIZE_KEY] = buffer.length;
    }
    return origEmit(eventName, ...args);
  };

  // --- Override on: replay buffer to the new listener (once per listener) --
  emitter.on = (eventName: string | symbol, listener: (...args: unknown[]) => void): EventEmitter => {
    origOn(eventName, listener);
    if (eventName === "event" && buffer.length > 0 && !replayedListeners.has(listener)) {
      replayedListeners.add(listener);
      for (const ev of buffer) {
        listener(ev);
      }
    }
    return emitter;
  };

  // --- Override once: also replay buffer for completeness ----------------
  emitter.once = (eventName: string | symbol, listener: (...args: unknown[]) => void): EventEmitter => {
    // Wrap the listener so we can track replay separately
    const wrapped = (...args: unknown[]) => {
      replayedListeners.delete(wrapped);
      listener(...args);
    };
    replayedListeners.add(wrapped);
    origOnce(eventName, wrapped);
    if (eventName === "event" && buffer.length > 0) {
      for (const ev of buffer) {
        wrapped(ev);
      }
    }
    return emitter;
  };

  emitters.set(runId, emitter);
  return emitter;
}

export function getRunEmitter(runId: string): EventEmitter | undefined {
  return emitters.get(runId);
}

export function removeRunEmitter(runId: string): void {
  const emitter = emitters.get(runId);
  if (emitter) {
    emitter.removeAllListeners();
    emitters.delete(runId);
  }
}

export function emitEvent(runId: string, event: OrchestratorEvent): void {
  const emitter = emitters.get(runId);
  if (emitter) {
    emitter.emit("event", event);
  }
}

/**
 * Return the number of events currently buffered for a given run.
 * Useful for diagnostics / testing.
 */
export function getBufferSize(runId: string): number {
  const emitter = emitters.get(runId);
  if (!emitter) return 0;
  // The buffer is private to the closure, so we expose size via a
  // non-enumerable symbol key attached to the emitter instance.
  return (emitter as unknown as Record<symbol, number>)[BUFFER_SIZE_KEY] ?? 0;
}

/** Symbol key used to stash buffer size on the emitter for diagnostics. */
const BUFFER_SIZE_KEY = Symbol("helmflow.bufferSize");

/**
 * Schedule cleanup of an emitter after a run finishes.
 * Removes the emitter from the map after CLEANUP_DELAY_MS, giving
 * in-flight SSE connections time to finish.
 * Returns the timeout handle so callers can cancel if needed.
 */
export function scheduleEmitterCleanup(runId: string): NodeJS.Timeout {
  return setTimeout(() => removeRunEmitter(runId), CLEANUP_DELAY_MS);
}