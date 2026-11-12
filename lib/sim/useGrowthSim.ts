"use client"

import { useEffect, useRef, useState } from "react"
import type { Frame, SimInput, SimResult, WorkerRequest, WorkerResponse } from "./vendor/sim-core/contract"

export type GrowthSimStatus = "idle" | "running" | "done" | "error"

export interface GrowthSimState {
  /** frames received so far for the current input (day 0..n, in order) */
  frames: Frame[]
  result: SimResult | null
  status: GrowthSimStatus
  error: string | null
  elapsedMs: number | null
}

const INITIAL: GrowthSimState = { frames: [], result: null, status: "idle", error: null, elapsedMs: null }

/**
 * Runs sim-core in a Web Worker. Frames are exposed progressively (batched per
 * animation frame). A new `input` (compared by `key`) cancels the in-flight run.
 */
export function useGrowthSim(input: SimInput | null, key: string): GrowthSimState {
  const [state, setState] = useState<GrowthSimState>(INITIAL)
  const workerRef = useRef<Worker | null>(null)
  const reqRef = useRef(0)

  // One worker per mounted hook.
  useEffect(() => {
    let worker: Worker
    try {
      worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" })
    } catch (e) {
      setState({ ...INITIAL, status: "error", error: e instanceof Error ? e.message : String(e) })
      return
    }
    workerRef.current = worker
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    const worker = workerRef.current
    if (!worker || !input) return
    const requestId = ++reqRef.current
    let pending: Frame[] = []
    let raf = 0
    const flush = () => {
      raf = 0
      if (!pending.length) return
      const batch = pending
      pending = []
      setState((s) => ({ ...s, frames: s.frames.concat(batch) }))
    }

    const onMessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data
      if (msg.requestId !== requestId) return
      if (msg.type === "frame") {
        pending.push(msg.frame)
        if (!raf) raf = requestAnimationFrame(flush)
      } else if (msg.type === "done") {
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        pending = []
        setState({ frames: msg.result.frames, result: msg.result, status: "done", error: null, elapsedMs: msg.elapsedMs })
      } else if (msg.message !== "cancelled") {
        // sim-core acknowledges `cancel` with error("cancelled") — a silent cancel, not a failure
        setState((s) => ({ ...s, status: "error", error: msg.message }))
      }
    }
    const onError = (ev: ErrorEvent) => {
      setState((s) => ({ ...s, status: "error", error: ev.message || "worker error" }))
    }

    worker.addEventListener("message", onMessage)
    worker.addEventListener("error", onError)
    setState({ ...INITIAL, status: "running" })
    const run: WorkerRequest = { type: "run", requestId, input }
    worker.postMessage(run)

    return () => {
      const cancel: WorkerRequest = { type: "cancel", requestId }
      worker.postMessage(cancel)
      worker.removeEventListener("message", onMessage)
      worker.removeEventListener("error", onError)
      if (raf) cancelAnimationFrame(raf)
    }
    // `key` stands in for deep equality of `input`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}
