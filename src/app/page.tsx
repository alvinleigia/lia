import Link from "next/link";

const highlights = [
  {
    label: "Visual flow builder",
    value:
      "Design channel-ready chatbot journeys with fields, branches, and actions.",
  },
  {
    label: "Multi-project SaaS",
    value:
      "Create separate Lia projects for brands, clients, locations, or campaigns.",
  },
  {
    label: "Widget and WhatsApp ready",
    value:
      "Keep flows channel-independent while connecting web widgets and WhatsApp.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7f8fa] text-[#111111]">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-between px-6 py-8 sm:px-10 lg:px-12">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#111111] font-semibold text-white">
              L
            </div>
            <div>
              <p className="text-lg font-semibold">Lia AI</p>
              <p className="text-sm text-[#626976]">by LS</p>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <Link
              className="rounded-md border border-[#d8dce3] bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-[#eef1f5]"
              href="/sign-in"
            >
              Sign In
            </Link>
            <Link
              className="rounded-md bg-[#111111] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#2c2c2c]"
              href="/sign-up"
            >
              Get Started
            </Link>
          </nav>
        </header>

        <div className="grid items-center gap-10 py-16 lg:grid-cols-[1.04fr_0.96fr]">
          <div className="max-w-2xl">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-[#16794f]">
              SaaS chatbot platform
            </p>
            <h1 className="text-4xl font-semibold leading-tight sm:text-5xl lg:text-6xl">
              Lia AI
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#4d5562]">
              Build, test, and run chatbot flows for websites, WhatsApp, and
              future customer channels from one project workspace.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                className="rounded-md bg-[#111111] px-5 py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-[#2c2c2c]"
                href="/sign-up"
              >
                Create Account
              </Link>
              <Link
                className="rounded-md border border-[#d8dce3] bg-white px-5 py-3 text-center text-sm font-semibold shadow-sm transition hover:bg-[#eef1f5]"
                href="/projects"
              >
                Open Projects
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-[#d8dce3] bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between border-b border-[#eef1f5] pb-4">
              <div>
                <p className="text-sm font-semibold">Flow Canvas</p>
                <p className="text-sm text-[#626976]">Lead capture assistant</p>
              </div>
              <span className="rounded-full bg-[#dcfce7] px-3 py-1 text-xs font-semibold text-[#166534]">
                Ready
              </span>
            </div>
            <div className="space-y-3">
              <div className="rounded-md border border-[#d8dce3] p-4">
                <p className="text-sm font-semibold">Welcome message</p>
                <p className="mt-1 text-sm text-[#626976]">
                  Greet visitors and identify the right intent.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-[#d8dce3] p-4">
                  <p className="text-sm font-semibold">Collect details</p>
                  <p className="mt-1 text-sm text-[#626976]">
                    Name, email, phone, and custom fields.
                  </p>
                </div>
                <div className="rounded-md border border-[#d8dce3] p-4">
                  <p className="text-sm font-semibold">Branch logic</p>
                  <p className="mt-1 text-sm text-[#626976]">
                    Route by answers, conditions, and channel capability.
                  </p>
                </div>
              </div>
              <div className="rounded-md border border-[#d8dce3] p-4">
                <p className="text-sm font-semibold">Handoff or action</p>
                <p className="mt-1 text-sm text-[#626976]">
                  Create a submission, call an operation, or send a reply.
                </p>
              </div>
            </div>
          </div>
        </div>

        <footer className="grid gap-3 border-t border-[#d8dce3] pt-6 sm:grid-cols-3">
          {highlights.map((item) => (
            <div key={item.label}>
              <p className="font-semibold">{item.label}</p>
              <p className="mt-1 text-sm leading-6 text-[#626976]">
                {item.value}
              </p>
            </div>
          ))}
        </footer>
      </section>
    </main>
  );
}
