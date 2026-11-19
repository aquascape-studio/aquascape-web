#!/usr/bin/env node
/**
 * DOM-equality check for feature-flagged work on /studio/sim.
 *
 *   node scripts/check-dom-equal.cjs <baseline> <candidate> [path]
 *   node scripts/check-dom-equal.cjs snap <origin> <out-file> [path]
 *
 * <baseline> / <candidate> are origins (http://localhost:3107) or files
 * written by `snap` — so two builds can be checked one after the other on
 * the same port.
 *
 * Loads the same path (default /studio/sim?day=45) from two running builds
 * (e.g. main and a branch, both built with the same NEXT_PUBLIC_FF_* flags),
 * waits for hydration, and compares the normalised DOM of <body>: build
 * hashes in asset URLs, React useId values, WebGL canvas sizes and timing
 * readouts ("123 ms") are masked. Exits 1 and prints the first difference
 * when they differ. Needs Playwright (`require("playwright")`).
 *
 * Flag-off checks done so far (baseline = the branch's base, candidate = the
 * branch, both built with the same flags):
 *  - dragEditor: GROWTH_TIMELAPSE + STYLIZED_TANK + STYLE_TEMPLATES on
 *  - commandPalette (compose 1.0.0): GROWTH_TIMELAPSE + STYLIZED_TANK +
 *    STYLE_TEMPLATES + DRAG_EDITOR on, COMMAND_PALETTE off
 *  - editor 1.3.0 conditions (2026-11-19): GROWTH_TIMELAPSE + STYLIZED_TANK on,
 *    STYLE_TEMPLATES / DRAG_EDITOR / COMMAND_PALETTE off (baseline origin/main)
 */
const { chromium } = require("playwright")

const fs = require("fs")
const SNAP = process.argv[2] === "snap"
const [baseA, baseB, path = "/studio/sim?day=45"] = process.argv.slice(SNAP ? 3 : 2)
if (!baseA || !baseB) {
  console.error("usage: check-dom-equal.cjs <baseline> <candidate> [path] | snap <origin> <out-file> [path]")
  process.exit(2)
}

async function snapshot(browser, origin) {
  if (!/^https?:/.test(origin)) return fs.readFileSync(origin, "utf8")
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" })
  const page = await ctx.newPage()
  await page.goto(origin + path, { waitUntil: "networkidle", timeout: 300000 })
  // time-lapse builds: wait for the simulation to finish (legacy page: no-op)
  await page.waitForFunction(() => !/Computing…/.test(document.body.innerText), null, { timeout: 300000 }).catch(() => {})
  await page.waitForTimeout(3000)
  const html = await page.evaluate(() => {
    const root = document.body.cloneNode(true)
    root.querySelectorAll("script, next-route-announcer, nextjs-portal").forEach((n) => n.remove())
    root.querySelectorAll("canvas").forEach((c) => {
      c.removeAttribute("width")
      c.removeAttribute("height")
      c.removeAttribute("style")
    })
    return root.innerHTML
  })
  await ctx.close()
  return html
    .replace(/\/_next\/static\/[^"')\s]+/g, "/_next/static/…")
    .replace(/«r[0-9a-z]+»|:r[0-9a-z]+:/g, "«id»")
    .replace(/\d+ ms/g, "… ms")
    .replace(/Computing… \d+\/\d+/g, "computing")
}

;(async () => {
  const browser = await chromium.launch()
  try {
    if (SNAP) {
      const html = await snapshot(browser, baseA)
      fs.writeFileSync(baseB, html)
      console.log(`saved ${html.length} chars → ${baseB}`)
      return
    }
    const [a, b] = [await snapshot(browser, baseA), await snapshot(browser, baseB)]
    if (a === b) {
      console.log(`DOM equal (${a.length} chars) — ${path}`)
      return
    }
    let i = 0
    while (i < a.length && a[i] === b[i]) i++
    console.log(`DOM differs at ${i} — ${path}`)
    console.log("baseline : …" + a.slice(Math.max(0, i - 200), i + 300))
    console.log("candidate: …" + b.slice(Math.max(0, i - 200), i + 300))
    process.exitCode = 1
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
