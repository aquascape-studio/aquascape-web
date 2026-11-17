"use client"

import dynamic from "next/dynamic"
import { useSearchParams, useRouter } from "next/navigation"
import { Suspense, useMemo } from "react"
import Link from "next/link"
import type { AquaScenePlant } from "@/app/components/AquaScene"

const AquaScene = dynamic(
  () => import("@/app/components/AquaScene").then((m) => ({ default: m.AquaScene })),
  { ssr: false, loading: () => <SceneLoader /> }
)

const BG = "#0F2A20"
const BORDER = "#1E3A2E"
const TEXT = "#EDE7D9"
const MUTED = "#8FAF9A"

const PLANT_META: Record<string, { growthForm: string; colorHex: string; name: string }> = {
  "java-moss":            { growthForm: "moss",      colorHex: "#5a8a3c", name: "Java Moss"         },
  "java-fern":            { growthForm: "epiphyte",  colorHex: "#3d6b3a", name: "Java Fern"         },
  "anubias-barteri":      { growthForm: "epiphyte",  colorHex: "#2f5d34", name: "Anubias"           },
  "amazon-sword":         { growthForm: "rosette",   colorHex: "#4a8a3e", name: "Amazon Sword"      },
  "rotala-rotundifolia":  { growthForm: "stem",      colorHex: "#d37a9a", name: "Rotala"            },
  "ludwigia-repens":      { growthForm: "stem",      colorHex: "#c0514a", name: "Ludwigia"          },
  "dwarf-hairgrass":      { growthForm: "carpeting", colorHex: "#5ea03b", name: "Dwarf Hairgrass"   },
  "monte-carlo":          { growthForm: "carpeting", colorHex: "#8fc25a", name: "Monte Carlo"       },
  "hc-cuba":              { growthForm: "carpeting", colorHex: "#7ab840", name: "HC Cuba"           },
  "glossostigma":         { growthForm: "carpeting", colorHex: "#7cc35a", name: "Glossostigma"      },
  "cryptocoryne-wendtii": { growthForm: "rosette",   colorHex: "#6b6b2e", name: "Cryptocoryne"      },
  "vallisneria":          { growthForm: "stem",      colorHex: "#4e8c3a", name: "Vallisneria"       },
  "hornwort":             { growthForm: "stem",      colorHex: "#78b84a", name: "Hornwort"          },
  "water-wisteria":       { growthForm: "stem",      colorHex: "#92b65a", name: "Water Wisteria"    },
  "aponogeton-ulvaceus":  { growthForm: "rosette",   colorHex: "#5a9e4a", name: "Aponogeton"        },
}

function SceneLoader() {
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: "#071912" }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "#3A6B50", borderTopColor: "transparent" }} />
        <p className="text-sm" style={{ color: MUTED }}>Rendering your tank…</p>
      </div>
    </div>
  )
}

function SceneContent() {
  const params = useSearchParams()
  const router = useRouter()

  const name = params.get("name") ?? "My Aquascape"
  const tankW = Number(params.get("w") ?? 60)
  const tankD = Number(params.get("d") ?? 30)
  const tankH = Number(params.get("h") ?? 36)
  const plantsRaw = params.get("plants")
  const selectedPlants: Record<string, number> = plantsRaw
    ? JSON.parse(plantsRaw)
    : { "rotala-rotundifolia": 5, "amazon-sword": 1, "monte-carlo": 8 }

  const scenePlants = useMemo<AquaScenePlant[]>(() =>
    Object.entries(selectedPlants)
      .map(([id, qty]) => {
        const meta = PLANT_META[id]
        if (!meta) return null
        return { id, ...meta, qty }
      })
      .filter(Boolean) as AquaScenePlant[],
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const simParams = params.toString()

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: "#071912" }}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{ backgroundColor: BG, borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-3">
          <Link href="/studio" className="text-sm hover:opacity-70" style={{ color: MUTED }}>
            ← Studio
          </Link>
          <span style={{ color: BORDER }}>/</span>
          <span className="text-sm font-medium" style={{ color: TEXT }}>{name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: BORDER, color: MUTED }}>
            {tankW}×{tankD}×{tankH} cm
          </span>
          <button
            onClick={() => router.push(`/studio/sim?${simParams}`)}
            className="text-sm px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70"
            style={{ backgroundColor: BORDER, color: MUTED }}
          >
            📈 Growth curve
          </button>
          <button
            onClick={() => router.push("/studio/new")}
            className="text-sm px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70"
            style={{ backgroundColor: BORDER, color: MUTED }}
          >
            Change setup
          </button>
        </div>
      </div>

      {/* 3D Canvas — fills remaining height */}
      <div className="flex-1 relative">
        <AquaScene
          tankW={tankW}
          tankD={tankD}
          tankH={tankH}
          plants={scenePlants}
        />

        {/* Plant legend overlay */}
        <div className="absolute bottom-4 left-4 rounded-xl border p-3 max-w-xs"
          style={{ backgroundColor: "rgba(15,42,32,0.85)", borderColor: BORDER, backdropFilter: "blur(6px)" }}>
          <p className="text-xs mb-2" style={{ color: MUTED }}>Plants</p>
          <div className="flex flex-col gap-1.5">
            {scenePlants.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.colorHex }} />
                <span className="text-xs" style={{ color: TEXT }}>{p.name}</span>
                <span className="text-xs ml-auto" style={{ color: MUTED }}>×{p.qty}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Controls hint */}
        <div className="absolute bottom-4 right-4 rounded-lg border px-3 py-2"
          style={{ backgroundColor: "rgba(15,42,32,0.85)", borderColor: BORDER, backdropFilter: "blur(6px)" }}>
          <p className="text-xs" style={{ color: MUTED }}>Drag to rotate · Scroll to zoom</p>
        </div>
      </div>
    </div>
  )
}

export default function ScenePage() {
  return (
    <Suspense fallback={<SceneLoader />}>
      <SceneContent />
    </Suspense>
  )
}
