"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

const BG = "#0F2A20"
const BORDER = "#1E3A2E"
const TEXT = "#EDE7D9"
const MUTED = "#8FAF9A"
const ACCENT = "#3A6B50"

const TANK_PRESETS = [
  { label: "Nano (30×20×25 cm)",   w: 30,  d: 20, h: 25, vol: 15  },
  { label: "Nano (45×27×30 cm)",   w: 45,  d: 27, h: 30, vol: 36  },
  { label: "Standard (60×30×36 cm)", w: 60,  d: 30, h: 36, vol: 65  },
  { label: "Large (90×45×45 cm)",  w: 90,  d: 45, h: 45, vol: 182 },
  { label: "XL (120×50×50 cm)",    w: 120, d: 50, h: 50, vol: 300 },
]

const PLANTS = [
  { id: "java-moss",            name: "Java Moss",         type: "Moss",      light: "Low",    co2: false },
  { id: "java-fern",            name: "Java Fern",         type: "Fern",      light: "Low",    co2: false },
  { id: "anubias-barteri",      name: "Anubias",           type: "Fern",      light: "Low",    co2: false },
  { id: "amazon-sword",         name: "Amazon Sword",      type: "Rosette",   light: "Medium", co2: false },
  { id: "rotala-rotundifolia",  name: "Rotala",            type: "Stem",      light: "Medium", co2: false },
  { id: "ludwigia-repens",      name: "Ludwigia",          type: "Stem",      light: "Medium", co2: false },
  { id: "dwarf-hairgrass",      name: "Dwarf Hairgrass",   type: "Carpeting", light: "High",   co2: true  },
  { id: "monte-carlo",          name: "Monte Carlo",       type: "Carpeting", light: "High",   co2: true  },
  { id: "hc-cuba",              name: "HC Cuba",           type: "Carpeting", light: "High",   co2: true  },
  { id: "cryptocoryne-wendtii", name: "Cryptocoryne",      type: "Rosette",   light: "Low",    co2: false },
  { id: "vallisneria",          name: "Vallisneria",       type: "Rosette",   light: "Medium", co2: false },
  { id: "hornwort",             name: "Hornwort",          type: "Stem",      light: "Low",    co2: false },
  { id: "water-wisteria",       name: "Water Wisteria",    type: "Stem",      light: "Medium", co2: false },
]

export default function NewTankPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [name, setName] = useState("My Aquascape")
  const [preset, setPreset] = useState(2) // 60cm default
  const [co2, setCo2] = useState(false)
  const [light, setLight] = useState<"Low" | "Medium" | "High">("Medium")
  const [selected, setSelected] = useState<Record<string, number>>({})

  function togglePlant(id: string) {
    setSelected((prev) => {
      if (prev[id]) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: 1 }
    })
  }

  function adjustQty(id: string, delta: number) {
    setSelected((prev) => {
      const qty = (prev[id] ?? 0) + delta
      if (qty <= 0) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: qty }
    })
  }

  function handleCreate() {
    const tank = TANK_PRESETS[preset] ?? TANK_PRESETS[2]!
    const params = new URLSearchParams({
      name,
      w: String(tank.w),
      d: String(tank.d),
      h: String(tank.h),
      co2: String(co2),
      light,
      plants: JSON.stringify(selected),
    })
    router.push(`/studio/scene?${params.toString()}`)
  }

  const plantCount = Object.keys(selected).length

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/studio" className="text-sm hover:opacity-70" style={{ color: MUTED }}>
          ← Studio
        </Link>
        <span style={{ color: BORDER }}>/</span>
        <span className="text-sm" style={{ color: TEXT }}>New tank</span>
      </div>

      {/* Steps indicator */}
      <div className="flex gap-2 mb-8">
        {([1, 2, 3] as const).map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                backgroundColor: step >= s ? ACCENT : BORDER,
                color: TEXT,
              }}
            >
              {s}
            </div>
            {s < 3 && <div className="w-8 h-px" style={{ backgroundColor: step > s ? ACCENT : BORDER }} />}
          </div>
        ))}
        <span className="ml-2 text-sm self-center" style={{ color: MUTED }}>
          {step === 1 ? "Choose a tank" : step === 2 ? "Add plants" : "Review"}
        </span>
      </div>

      {/* Step 1: Tank size */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold" style={{ color: TEXT }}>Tank size</h2>
          <div className="flex flex-col gap-2">
            {TANK_PRESETS.map((t, i) => (
              <button
                key={i}
                onClick={() => setPreset(i)}
                className="flex items-center justify-between rounded-xl border px-5 py-4 text-left transition-colors"
                style={{
                  backgroundColor: preset === i ? ACCENT : BG,
                  borderColor: preset === i ? ACCENT : BORDER,
                }}
              >
                <span className="font-medium text-sm" style={{ color: TEXT }}>{t.label}</span>
                <span className="text-xs" style={{ color: preset === i ? "#c8e6d4" : MUTED }}>{t.vol} L</span>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 mt-2">
            <label className="text-sm" style={{ color: MUTED }}>Tank name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg px-4 py-3 text-sm outline-none"
              style={{ backgroundColor: BG, border: `1px solid ${BORDER}`, color: TEXT }}
            />
          </div>
          <button
            onClick={() => setStep(2)}
            className="mt-2 rounded-lg px-6 py-3 font-medium text-sm transition-opacity hover:opacity-80"
            style={{ backgroundColor: ACCENT, color: TEXT }}
          >
            Next →
          </button>
        </div>
      )}

      {/* Step 2: Plant selection */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold" style={{ color: TEXT }}>Choose plants</h2>
            <span className="text-sm" style={{ color: MUTED }}>{plantCount} selected</span>
          </div>
          <div className="flex flex-col gap-2 max-h-[460px] overflow-y-auto pr-1">
            {PLANTS.map((p) => {
              const qty = selected[p.id] ?? 0
              const active = qty > 0
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl border px-4 py-3"
                  style={{
                    backgroundColor: active ? "#0F2A20" : BG,
                    borderColor: active ? ACCENT : BORDER,
                  }}
                >
                  <button
                    onClick={() => togglePlant(p.id)}
                    className="flex items-center gap-3 flex-1 text-left"
                  >
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center text-xs shrink-0"
                      style={{ backgroundColor: active ? ACCENT : BORDER, color: TEXT }}
                    >
                      {active ? "✓" : "+"}
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: TEXT }}>{p.name}</p>
                      <p className="text-xs" style={{ color: MUTED }}>
                        {p.type} · {p.light} light{p.co2 ? " · CO₂" : ""}
                      </p>
                    </div>
                  </button>
                  {active && (
                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      <button
                        onClick={() => adjustQty(p.id, -1)}
                        className="w-6 h-6 rounded text-sm font-bold flex items-center justify-center hover:opacity-70"
                        style={{ backgroundColor: BORDER, color: TEXT }}
                      >−</button>
                      <span className="text-sm w-4 text-center" style={{ color: TEXT }}>{qty}</span>
                      <button
                        onClick={() => adjustQty(p.id, 1)}
                        className="w-6 h-6 rounded text-sm font-bold flex items-center justify-center hover:opacity-70"
                        style={{ backgroundColor: BORDER, color: TEXT }}
                      >+</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex gap-3 mt-2">
            <button
              onClick={() => setStep(1)}
              className="rounded-lg px-5 py-3 text-sm transition-opacity hover:opacity-70"
              style={{ backgroundColor: BORDER, color: MUTED }}
            >
              ← Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={plantCount === 0}
              className="flex-1 rounded-lg px-6 py-3 font-medium text-sm transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ backgroundColor: ACCENT, color: TEXT }}
            >
              Next → {plantCount > 0 && `(${plantCount} ${plantCount === 1 ? "plant" : "plants"})`}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Settings + confirm */}
      {step === 3 && (
        <div className="flex flex-col gap-5">
          <h2 className="text-xl font-semibold" style={{ color: TEXT }}>Environment</h2>

          {/* Light */}
          <div className="flex flex-col gap-2">
            <label className="text-sm" style={{ color: MUTED }}>Light</label>
            <div className="flex gap-2">
              {(["Low", "Medium", "High"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLight(l)}
                  className="flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: light === l ? ACCENT : BORDER,
                    color: TEXT,
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* CO2 */}
          <div className="flex items-center justify-between rounded-xl border px-5 py-4"
            style={{ backgroundColor: BG, borderColor: BORDER }}>
            <div>
              <p className="text-sm font-medium" style={{ color: TEXT }}>CO₂ injection</p>
              <p className="text-xs mt-0.5" style={{ color: MUTED }}>Speeds up plant growth</p>
            </div>
            <button
              onClick={() => setCo2(!co2)}
              className="relative w-11 h-6 rounded-full transition-colors"
              style={{ backgroundColor: co2 ? ACCENT : BORDER }}
            >
              <span
                className="absolute top-1 w-4 h-4 rounded-full transition-all"
                style={{
                  backgroundColor: TEXT,
                  left: co2 ? "calc(100% - 20px)" : "4px",
                }}
              />
            </button>
          </div>

          {/* Summary */}
          <div className="rounded-xl border p-5 flex flex-col gap-2"
            style={{ backgroundColor: BG, borderColor: BORDER }}>
            <p className="text-sm font-semibold" style={{ color: TEXT }}>{name}</p>
            <p className="text-xs" style={{ color: MUTED }}>
              {TANK_PRESETS[preset]?.label} · {plantCount} {plantCount === 1 ? "plant" : "plants"} ·{" "}
              {light} light{co2 ? " · CO₂" : ""}
            </p>
            <div className="flex flex-wrap gap-1 mt-1">
              {Object.entries(selected).map(([id, qty]) => {
                const p = PLANTS.find((x) => x.id === id)
                return p ? (
                  <span key={id} className="rounded px-2 py-0.5 text-xs"
                    style={{ backgroundColor: BORDER, color: MUTED }}>
                    {p.name} ×{qty}
                  </span>
                ) : null
              })}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="rounded-lg px-5 py-3 text-sm transition-opacity hover:opacity-70"
              style={{ backgroundColor: BORDER, color: MUTED }}
            >
              ← Back
            </button>
            <button
              onClick={handleCreate}
              className="flex-1 rounded-lg px-6 py-3 font-medium text-sm transition-opacity hover:opacity-80"
              style={{ backgroundColor: ACCENT, color: TEXT }}
            >
              🔬 Run simulation
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
