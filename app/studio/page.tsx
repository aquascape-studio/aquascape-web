import { auth } from "@/auth"
import Link from "next/link"

const BG = "#0F2A20"
const BORDER = "#1E3A2E"
const TEXT = "#EDE7D9"
const MUTED = "#8FAF9A"
const ACCENT = "#3A6B50"

export default async function StudioPage() {
  const session = await auth()

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {!session && (
        <div
          className="mb-8 flex items-center justify-between rounded-xl border px-5 py-4"
          style={{ backgroundColor: BG, borderColor: BORDER }}
        >
          <p className="text-sm" style={{ color: MUTED }}>
            You’re browsing as a guest. Sign in to save your tanks.
          </p>
          <div className="flex gap-3 ml-4 shrink-0">
            <Link
              href="/login"
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80"
              style={{ backgroundColor: ACCENT, color: TEXT }}
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80"
              style={{ backgroundColor: BORDER, color: MUTED }}
            >
              Sign up
            </Link>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold" style={{ color: TEXT }}>
          {session?.user?.name ? `${session.user.name}’s Studio` : "Studio"}
        </h1>
        <p className="mt-1 text-sm" style={{ color: MUTED }}>
          Design your planted tank and simulate how it grows.
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-10">
        <ActionCard
          icon="🌿"
          title="New tank"
          desc="Start from an empty tank"
          href="/studio/new"
          primary
        />
        <ActionCard
          icon="🔬"
          title="Run a simulation"
          desc="See 30 days of plant growth"
          href="/studio/sim"
        />
        <ActionCard
          icon="📚"
          title="Browse plants"
          desc="Explore 15 aquatic plants"
          href="/plants"
        />
      </div>

      {/* My scapes */}
      <section>
        <h2 className="text-lg font-semibold mb-4" style={{ color: TEXT }}>
          My tanks
        </h2>
        <EmptyScapes loggedIn={!!session} />
      </section>

      {/* Feature preview */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold mb-4" style={{ color: TEXT }}>
          Coming soon
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FeatureCard icon="🎨" title="3D view" desc="Your tank, rendered in real time" />
          <FeatureCard icon="📈" title="One-year growth" desc="Forecast biomass and plant health" />
          <FeatureCard icon="💧" title="Water chemistry" desc="CO₂, fertiliser and light, modelled together" />
          <FeatureCard icon="🤝" title="Share" desc="Export and share your layout" />
        </div>
      </section>
    </main>
  )
}

function ActionCard({
  icon, title, desc, href, primary,
}: {
  icon: string; title: string; desc: string; href: string; primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border p-5 transition-opacity hover:opacity-80"
      style={{
        backgroundColor: primary ? ACCENT : BG,
        borderColor: primary ? ACCENT : BORDER,
      }}
    >
      <span className="text-2xl">{icon}</span>
      <span className="font-semibold text-sm" style={{ color: TEXT }}>{title}</span>
      <span className="text-xs" style={{ color: primary ? "#c8e6d4" : MUTED }}>{desc}</span>
    </Link>
  )
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div
      className="flex items-start gap-3 rounded-xl border p-4"
      style={{ backgroundColor: BG, borderColor: BORDER }}
    >
      <span className="text-xl mt-0.5">{icon}</span>
      <div>
        <p className="text-sm font-medium" style={{ color: TEXT }}>{title}</p>
        <p className="text-xs mt-0.5" style={{ color: MUTED }}>{desc}</p>
      </div>
    </div>
  )
}

function EmptyScapes({ loggedIn }: { loggedIn: boolean }) {
  return (
    <div
      className="rounded-xl border border-dashed flex flex-col items-center justify-center py-14 px-6 text-center"
      style={{ borderColor: BORDER }}
    >
      <span className="text-4xl mb-3">🪴</span>
      <p className="text-sm font-medium mb-1" style={{ color: TEXT }}>No tanks yet</p>
      <p className="text-xs mb-4" style={{ color: MUTED }}>
        {loggedIn
          ? "Choose New tank to start your first layout."
          : "Sign in to create and save your layouts."}
      </p>
      {loggedIn ? (
        <Link
          href="/studio/new"
          className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
          style={{ backgroundColor: ACCENT, color: TEXT }}
        >
          New tank
        </Link>
      ) : (
        <Link
          href="/login"
          className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
          style={{ backgroundColor: ACCENT, color: TEXT }}
        >
          Sign in
        </Link>
      )}
    </div>
  )
}
