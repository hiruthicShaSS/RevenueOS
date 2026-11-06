import { useState, type FormEvent } from "react";
import { ArrowRight, Brain, Handshake, Users } from "lucide-react";
import { Brand, ThemeSwitch } from "../components/Layout";
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
    <div className="relative grid min-h-full place-items-center px-5 py-12">
      <div className="absolute right-5 top-5">
        <ThemeSwitch />
      </div>
      <div className="grid w-full max-w-5xl items-center gap-14 md:grid-cols-[1.1fr_1fr]">
        <div className="stagger hidden md:block">
          <Brand size="lg" />
          <h1 className="mt-10 text-[38px] font-semibold leading-[1.1] tracking-[-0.025em] text-fg">
            One memory for
            <br />
            the whole sales team.
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-mute">
            Every call, meeting and email your teammates log is remembered per customer. When it is your turn to negotiate, you start with everything the team has heard.
          </p>
          <div className="mt-9 space-y-3.5 text-[14px] text-soft">
            <Point icon={Users}>Each teammate logs their own conversations</Point>
            <Point icon={Brain}>Hindsight keeps one shared memory per customer</Point>
            <Point icon={Handshake}>The Deal Negotiator reasons over all of it</Point>
          </div>
        </div>

        <form onSubmit={submit} className="pop-in rounded-2xl border border-line bg-panel p-8 shadow-card">
          <div className="mb-6 md:hidden"><Brand /></div>
          <div className="text-[20px] font-semibold text-fg">Sign in</div>
          <p className="mt-1.5 text-[13.5px] text-mute">Use your work email. First time here? We'll set you up.</p>
          <label className="mt-7 block text-[13px] font-medium text-soft">Work email</label>
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
          <label className="mt-5 block text-[13px] font-medium text-soft">Designation</label>
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
          {error && <div className="mt-3 text-[13px] text-bad">{error}</div>}
          <Button type="submit" loading={busy} disabled={!email.trim() || designation.trim().length < 2} className="mt-6 w-full py-2.5">
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
          <p className="mt-5 text-[12.5px] leading-relaxed text-mute">Your name and designation are attached to everything you log, so teammates know who heard what.</p>
        </form>
      </div>
    </div>
  );
}

function Point({ icon: Icon, children }: { icon: typeof Users; children: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-panel">
        <Icon className="h-4 w-4 text-accent-strong dark:text-accent" />
      </div>
      {children}
    </div>
  );
}
