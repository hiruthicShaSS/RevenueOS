import { useState, type FormEvent } from "react";
import { ArrowRight, Brain, Handshake, Sparkles, Users } from "lucide-react";
import { useAuth } from "../auth";
import { Button, inputCls } from "../components/ui";

const DESIGNATIONS = [
  "Account Executive",
  "Senior Account Executive",
  "Enterprise Account Executive",
  "Solutions Engineer",
  "Sales Manager",
  "Customer Success Manager",
  "VP of Sales",
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [designation, setDesignation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, designation);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glow grid min-h-full place-items-center px-5 py-10">
      <div className="grid w-full max-w-4xl items-center gap-12 md:grid-cols-[1.1fr_1fr]">
        <div className="hidden md:block">
          <div className="flex items-center gap-2.5">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-accent-2 to-mem shadow-[0_8px_24px_-6px_rgb(99_102_241/0.7)]">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div className="text-xl font-semibold tracking-tight text-white">RevenueOS</div>
          </div>
          <h1 className="mt-8 text-[34px] font-semibold leading-tight tracking-tight text-white">
            One memory for
            <br />
            the whole sales team.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-mute">
            Every call, meeting and email your teammates log is remembered per customer. When it is your turn to negotiate, you start with everything the team has heard.
          </p>
          <div className="mt-8 space-y-3 text-[13px] text-soft">
            <Point icon={Users}>Each teammate logs their own conversations</Point>
            <Point icon={Brain}>Hindsight keeps one shared memory per customer</Point>
            <Point icon={Handshake}>The Deal Negotiator reasons over all of it</Point>
          </div>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-line bg-panel/80 p-7 backdrop-blur">
          <div className="text-lg font-semibold text-white">Sign in</div>
          <p className="mt-1 text-xs text-mute">Use your work email. First time here? We'll set you up.</p>
          <label className="mt-6 block text-xs font-medium text-soft">Work email</label>
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            className={`${inputCls} mt-1.5 py-2.5`}
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label className="mt-4 block text-xs font-medium text-soft">Designation</label>
          <input
            required
            list="designations"
            autoComplete="organization-title"
            className={`${inputCls} mt-1.5 py-2.5`}
            placeholder="e.g. Account Executive"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
          />
          <datalist id="designations">
            {DESIGNATIONS.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          {error && <div className="mt-3 text-xs text-bad">{error}</div>}
          <Button type="submit" loading={busy} disabled={!email.trim() || designation.trim().length < 2} className="mt-6 w-full py-2.5">
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
          <p className="mt-4 text-[11px] leading-relaxed text-mute">Your name and designation are attached to everything you log, so teammates know who heard what.</p>
        </form>
      </div>
    </div>
  );
}

function Point({ icon: Icon, children }: { icon: typeof Users; children: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-white/[0.03]">
        <Icon className="h-3.5 w-3.5 text-accent" />
      </div>
      {children}
    </div>
  );
}
