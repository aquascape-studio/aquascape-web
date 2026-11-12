/**
 * Runs @aquascape/sim-core off the main thread. Instantiate with
 *   new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" })
 */
import { createWorkerHandler } from "./vendor/sim-core"
import type { WorkerRequest, WorkerResponse } from "./vendor/sim-core"

const scope = self as unknown as {
  postMessage(msg: WorkerResponse): void
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null
}

const handle = createWorkerHandler((msg) => scope.postMessage(msg))
scope.onmessage = (ev) => handle(ev.data)
