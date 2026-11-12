"use client"

import dynamic from "next/dynamic"

/** Code-split so the legacy (flag-off) route does not ship the time-lapse bundle. */
const TimelapseView = dynamic(() => import("./TimelapseView"))
export default TimelapseView
