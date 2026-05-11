import {
  listPendingFrames,
  pollPendingFrame,
} from "../services/ai/generate-frame";

const INTERVAL_MS = 7000;

let handle: NodeJS.Timeout | null = null;
let pollInFlight = false;

/**
 * Polls every pending frame once. Shared by the periodic timer and the
 * `frames.syncPending` mutation — the `pollInFlight` flag prevents either
 * from double-finalizing a frame that's mid-download.
 */
export async function pollAllPending(): Promise<{
  polled: number;
  ready: number;
  failed: number;
  stillGenerating: number;
  skipped: boolean;
}> {
  if (pollInFlight) {
    return { polled: 0, ready: 0, failed: 0, stillGenerating: 0, skipped: true };
  }
  pollInFlight = true;
  try {
    const pending = await listPendingFrames();
    if (pending.length === 0) {
      return { polled: 0, ready: 0, failed: 0, stillGenerating: 0, skipped: false };
    }
    const results = await Promise.all(
      pending.map((f) =>
        pollPendingFrame(f.id).catch((err) => {
          console.error(`[v4 poller] frame=${f.id}:`, (err as Error).message);
          return "error" as const;
        }),
      ),
    );
    return {
      polled: pending.length,
      ready: results.filter((r) => r === "ready").length,
      failed: results.filter((r) => r === "error").length,
      stillGenerating: results.filter((r) => r === "generating").length,
      skipped: false,
    };
  } finally {
    pollInFlight = false;
  }
}

async function tick() {
  try {
    await pollAllPending();
  } catch (err) {
    console.error("[v4 poller] tick failed:", err);
  }
}

/**
 * Starts the background poller. Idempotent — calling twice is a no-op.
 * Runs once immediately so any frames stuck from a previous boot get picked up.
 */
export function startPendingPoller(): void {
  if (handle) return;
  if (!process.env.ATLASCLOUD_API_KEY) {
    console.log("[v4 poller] ATLASCLOUD_API_KEY not set — pending poller disabled");
    return;
  }
  handle = setInterval(() => void tick(), INTERVAL_MS);
  // Catch up immediately on boot.
  void tick();
  console.log(`[v4 poller] started (interval=${INTERVAL_MS}ms)`);
}

export function stopPendingPoller(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
}
