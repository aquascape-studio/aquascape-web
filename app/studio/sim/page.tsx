import { flags } from "@/lib/flags"
import LegacySim from "./LegacySim"
import GrowthTimelapse from "./GrowthTimelapse"

export default function SimPage() {
  return flags.growthTimelapse ? <GrowthTimelapse /> : <LegacySim />
}
