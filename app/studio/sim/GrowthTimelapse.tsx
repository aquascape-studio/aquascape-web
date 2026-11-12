import { Suspense } from "react"
import { Inter, Noto_Sans_SC } from "next/font/google"
import TimelapseView from "./timelapse/LazyTimelapseView"
import { TOKENS, tokenVars } from "./timelapse/tokens"

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--tl-font-latin" })
const notoSC = Noto_Sans_SC({
  weight: ["400", "500", "700"],
  display: "swap",
  preload: false,
  variable: "--tl-font-cjk",
})

/**
 * Route-scoped overrides: while the time-lapse is mounted, the global (dark)
 * NavBar and body take the light "超白玻璃" treatment. Removed on unmount.
 */
const SCOPED_CSS = `
body { background: ${TOKENS.bg} !important; color: ${TOKENS.text} !important; }
body > nav {
  position: sticky; top: 0; z-index: 40; height: 52px; padding-top: 0 !important; padding-bottom: 0 !important;
  background: rgba(255,255,255,0.78) !important;
  -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid rgba(0,0,0,0.06) !important;
}
body > nav a, body > nav span { color: ${TOKENS.text} !important; }
body > nav a[href="/login"], body > nav button {
  background: ${TOKENS.accent} !important; color: ${TOKENS.bg} !important; border-radius: 999px !important;
  min-height: 32px; display: inline-flex; align-items: center; padding-left: 14px !important; padding-right: 14px !important;
}
body > nav a[href="/login"]:hover, body > nav button:hover { background: ${TOKENS.accentHover} !important; opacity: 1 !important; }

.tl-root {
  font-family: var(--tl-font-latin), var(--tl-font-cjk), -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.tl-root .tl-num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
.tl-root .tl-h1 { font-size: clamp(44px, 6.6vw, 88px); font-weight: 700; letter-spacing: -0.04em; line-height: 1.05; }
.tl-root .tl-h2 { font-size: clamp(36px, 4.6vw, 64px); font-weight: 700; letter-spacing: -0.035em; line-height: 1.05; }
.tl-root .tl-h3 { font-size: clamp(22px, 2.4vw, 28px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; }
.tl-root :focus-visible { outline: 2px solid ${TOKENS.accent}; outline-offset: 2px; }
.tl-root .tl-glass {
  background: ${TOKENS.glass};
  -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
  box-shadow: 0 18px 40px -18px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.06);
}

/* range slider */
.tl-root .tl-range { -webkit-appearance: none; appearance: none; width: 100%; height: 44px; background: transparent; cursor: pointer; accent-color: ${TOKENS.accent}; }
.tl-root .tl-range::-webkit-slider-runnable-track {
  height: 4px; border-radius: 999px;
  background: linear-gradient(to right, ${TOKENS.accent} 0 var(--pct), ${TOKENS.hairline} var(--pct) 100%);
}
.tl-root .tl-range::-moz-range-track { height: 4px; border-radius: 999px; background: ${TOKENS.hairline}; }
.tl-root .tl-range::-moz-range-progress { height: 4px; border-radius: 999px; background: ${TOKENS.accent}; }
.tl-root .tl-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 22px; height: 22px; margin-top: -9px; border-radius: 999px;
  background: ${TOKENS.bg}; box-shadow: 0 1px 4px rgba(0,0,0,0.28), 0 0 0 0.5px rgba(0,0,0,0.12);
}
.tl-root .tl-range::-moz-range-thumb {
  width: 22px; height: 22px; border: 0; border-radius: 999px;
  background: ${TOKENS.bg}; box-shadow: 0 1px 4px rgba(0,0,0,0.28), 0 0 0 0.5px rgba(0,0,0,0.12);
}

@media (prefers-reduced-motion: reduce) {
  .tl-root *, .tl-root *::before, .tl-root *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`

export default function GrowthTimelapse() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SCOPED_CSS }} />
      <div
        className={`${inter.variable} ${notoSC.variable} tl-root min-h-screen`}
        style={{ ...tokenVars, backgroundColor: "var(--tl-bg)", color: "var(--tl-text)" }}
      >
        <Suspense
          fallback={
            <p className="px-6 py-24 text-center text-sm" style={{ color: "var(--tl-muted)" }}>
              加载中… Loading
            </p>
          }
        >
          <TimelapseView />
        </Suspense>
      </div>
    </>
  )
}
