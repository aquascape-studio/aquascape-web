"use client"

import { useId, useState } from "react"
import type { Frame, PlantPlacement, TankDims } from "@/lib/sim/vendor/sim-core/contract"
import type { SpeciesMeta } from "./derive"
import { c, rampColor } from "./tokens"

interface Props {
  frame: Frame | undefined
  tank: TankDims
  placements: PlantPlacement[]
  species: SpeciesMeta[]
  lowLightPar: number
  /** fixed colour-scale max so the map is comparable across days */
  parMax: number
  selectedId: string | null
  onSelect: (plantId: string) => void
}

/** SVG path tracing the boundary of the below-threshold cells (incl. the tank wall). */
function lowOutline(par: Float32Array, nx: number, nz: number, cw: number, ch: number, thr: number): string {
  const low = (ix: number, iz: number) => ix >= 0 && iz >= 0 && ix < nx && iz < nz && (par[iz * nx + ix] ?? Infinity) < thr
  const seg: string[] = []
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      if (!low(ix, iz)) continue
      const x0 = ix * cw, x1 = x0 + cw, y0 = iz * ch, y1 = y0 + ch
      if (!low(ix, iz - 1)) seg.push(`M${x0},${y0}H${x1}`)
      if (!low(ix, iz + 1)) seg.push(`M${x0},${y1}H${x1}`)
      if (!low(ix - 1, iz)) seg.push(`M${x0},${y0}V${y1}`)
      if (!low(ix + 1, iz)) seg.push(`M${x1},${y0}V${y1}`)
    }
  }
  return seg.join("")
}

export default function LightMap({ frame, tank, placements, species, lowLightPar, parMax, selectedId, onSelect }: Props) {
  const pid = useId().replace(/:/g, "")
  const [hover, setHover] = useState<{ ix: number; iz: number } | null>(null)
  const W = tank.widthCm
  const D = tank.depthCm
  const grid = frame?.light
  const nx = grid?.nx ?? 1
  const nz = grid?.nz ?? 1
  const cw = W / nx
  const ch = D / nz
  const spOf = (id: string) => species.find((s) => s.instanceIds.includes(id))
  const byId = new Map(frame?.plants.map((p) => [p.id, p]) ?? [])
  const hoverPar = hover && grid ? grid.par[hover.iz * nx + hover.ix] : undefined

  // draw larger footprints first so small plants stay clickable
  const order = [...placements].sort((a, b) => (byId.get(b.id)?.spreadCm ?? 0) - (byId.get(a.id)?.spreadCm ?? 0))

  return (
    <div>
      <p className="mb-2 text-[12px] font-medium" style={{ color: c("muted") }}>
        后 Back <span className="tl-num">· {W}×{D} cm</span>
      </p>
      <div className="relative">
        <svg
          viewBox={`-1.5 -1.5 ${W + 3} ${D + 3}`}
          className="block w-full"
          role="img"
          aria-label={`俯视光照图 Top-down light map, ${nx}×${nz} cells; 缺光 cells below ${lowLightPar} PAR are hatched`}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <pattern id={`h${pid}`} width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="2.2" stroke={c("coral")} strokeWidth="0.28" strokeOpacity="0.75" />
            </pattern>
            <clipPath id={`clip${pid}`}>
              <rect x="0" y="0" width={W} height={D} rx="2" />
            </clipPath>
          </defs>
          <g clipPath={`url(#clip${pid})`}>
            <rect x="0" y="0" width={W} height={D} fill={c("green0")} />
            {grid &&
              Array.from({ length: nz }, (_, iz) =>
                Array.from({ length: nx }, (_, ix) => {
                  const p = grid.par[iz * nx + ix] ?? 0
                  const low = p < lowLightPar
                  return (
                    <g key={`${ix}-${iz}`} onPointerEnter={() => setHover({ ix, iz })}>
                      <rect x={ix * cw} y={iz * ch} width={cw + 0.02} height={ch + 0.02} fill={rampColor(p / parMax)} />
                      {low && <rect x={ix * cw} y={iz * ch} width={cw + 0.02} height={ch + 0.02} fill={`url(#h${pid})`} />}
                    </g>
                  )
                }),
              )}
            {grid && (
              <path d={lowOutline(grid.par, nx, nz, cw, ch, lowLightPar)} fill="none" stroke={c("coral")} strokeWidth="0.4" strokeLinecap="square" />
            )}
          </g>
          <rect x="0" y="0" width={W} height={D} rx="2" fill="none" stroke={c("hairline")} strokeWidth="0.3" />

          <g clipPath={`url(#clip${pid})`}>
          {order.map((pl) => {
            const pf = byId.get(pl.id)
            const r = Math.max(0.9, (pf?.spreadCm ?? 2) / 2)
            const cx = pl.x + W / 2
            const cy = pl.z + D / 2
            const sp = spOf(pl.id)
            const sel = pl.id === selectedId
            return (
              <g
                key={pl.id}
                role="button"
                tabIndex={-1}
                aria-label={`${sp?.zh ?? pl.speciesId} ${pl.id}`}
                className="cursor-pointer"
                onClick={() => onSelect(pl.id)}
              >
                <circle cx={cx} cy={cy} r={Math.max(r, 2.2)} fill="transparent" />
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={sp?.red ? c("coral") : c("green4")}
                  fillOpacity={sel ? 0.5 : 0.28}
                  stroke={sel ? c("text") : sp?.red ? c("warn") : c("green4")}
                  strokeWidth={sel ? 0.45 : 0.25}
                />
                <circle cx={cx} cy={cy} r="0.55" fill={sel ? c("text") : c("bg")} stroke={c("text")} strokeWidth="0.15" />
              </g>
            )
          })}
          </g>
        </svg>
        {hover && hoverPar !== undefined && (
          <div
            className="pointer-events-none absolute z-10 rounded-[12px] px-2.5 py-1.5 text-xs tl-glass tl-num"
            style={{
              left: `${((hover.ix + 0.5) / nx) * 100}%`,
              top: `${((hover.iz + 0.5) / nz) * 100}%`,
              transform: `translate(${hover.ix > nx * 0.7 ? "-110%" : "12px"}, -50%)`,
            }}
          >
            <span className="font-semibold">{Math.round(hoverPar)} PAR</span>
            {hoverPar < lowLightPar && <span style={{ color: c("warn") }}> · 缺光 low light</span>}
          </div>
        )}
      </div>

      <p className="mt-2 text-[12px] font-medium" style={{ color: c("muted") }}>前 Front · 观赏面 viewing side</p>

      {/* legend */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs" style={{ color: c("muted") }}>
        <div className="flex items-center gap-2">
          <span>PAR</span>
          <span className="tl-num">0</span>
          <span
            className="inline-block h-2.5 w-32 rounded-full"
            style={{
              background: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => rampColor(t)).join(",")})`,
              boxShadow: `inset 0 0 0 1px ${c("hairline")}`,
            }}
          />
          <span className="tl-num">{Math.round(parMax)}</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden>
            <defs>
              <pattern id={`lh${pid}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="4" height="4" fill={c("coralSoft")} />
                <line x1="0" y1="0" x2="0" y2="4" stroke={c("coral")} strokeWidth="1.4" />
              </pattern>
            </defs>
            <rect x="0.75" y="0.75" width="16.5" height="12.5" rx="3" fill={`url(#lh${pid})`} stroke={c("coral")} strokeWidth="1.2" />
          </svg>
          <span style={{ color: c("warn") }} className="font-medium">
            缺光 low light
          </span>
          <span className="tl-num">&lt; {lowLightPar} PAR</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <circle cx="8" cy="8" r="7" fill={c("green4")} fillOpacity="0.28" stroke={c("green4")} />
            <circle cx="8" cy="8" r="1.6" fill={c("bg")} stroke={c("text")} strokeWidth="0.6" />
          </svg>
          <span>植株 · 圆径 = 冠幅 spread</span>
        </div>
      </div>
    </div>
  )
}
