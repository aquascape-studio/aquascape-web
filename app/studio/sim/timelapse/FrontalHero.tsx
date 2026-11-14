"use client"

/**
 * Stylized front-view tank canvas (behind `flags.stylizedTank`). Loaded only
 * via `next/dynamic({ ssr: false })` from TimelapseView when the flag is on, so
 * three / R3F / @aquascape-studio/render stay out of the flag-off page. Fills
 * its parent; the parent owns the size (aspect box) and caption.
 */
import { useEffect, useMemo, useState } from "react"
import { FrontalTank, speciesLook } from "@aquascape-studio/render"
import type { BotanyRecordLike, CompositionGuide, HardscapeVisual } from "@aquascape-studio/render"
import { toFrontal } from "@/lib/sim/toFrontal"
import type { Frame, SimInput } from "@/lib/sim/vendor/sim-core/contract"

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return reduced
}

export interface FrontalHeroProps {
  input: SimInput
  frame: Frame | undefined
  byId: ReadonlyMap<string, BotanyRecordLike>
  onReady: () => void
  /**
   * Style-template scene (behind `flags.styleTemplates`). When absent the tank
   * renders exactly as before: default hardscape, no guides / focal / bed props.
   */
  scene?: {
    hardscape: HardscapeVisual[]
    bed: { frontCm: number; backCm: number } | undefined
    focalPoint: { x: number; y: number } | undefined
    guides: CompositionGuide
  } | undefined
}

export default function FrontalHero({ input, frame, byId, onReady, scene }: FrontalHeroProps) {
  const reducedMotion = useReducedMotion()
  const data = useMemo(() => toFrontal(input, frame, byId, speciesLook), [input, frame, byId])
  return (
    <FrontalTank
      tank={data.tank}
      species={data.species}
      plants={data.plants}
      hardscape={scene ? scene.hardscape : data.hardscape}
      {...(scene ? { guides: scene.guides, focalPoint: scene.focalPoint, bed: scene.bed } : {})}
      quality="auto"
      reducedMotion={reducedMotion}
      data-testid="frontal-tank"
      onReady={onReady}
    />
  )
}
