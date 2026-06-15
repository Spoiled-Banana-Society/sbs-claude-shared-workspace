'use client';

/**
 * Bell vs banner flow — before/after showcase (TEMP, safe to delete).
 * What used to fire (banners + bells) vs what fires now (one banner + bells),
 * for new vs returning users. Live at /test-bell-flow.
 */

type Row = { label: string; kind: 'banner' | 'bell'; when: string; note?: string };

const NEW_BEFORE: Row[] = [
  { label: 'New User Spin', kind: 'banner', when: 'home, while new' },
  { label: 'First Purchase', kind: 'banner', when: 'home, after free drafts' },
  { label: 'Founder Draft', kind: 'banner', when: 'home + draft, Tue→Wed' },
  { label: 'Get the App', kind: 'banner', when: 'home' },
  { label: 'Welcome bell', kind: 'bell', when: 'on signup' },
  { label: 'Welcome bell (again)', kind: 'bell', when: 'on X verify', note: 'DUPLICATE' },
  { label: 'First Purchase Bonus bell', kind: 'bell', when: 'after free drafts' },
];
const NEW_NOW: Row[] = [
  { label: 'Get the App', kind: 'banner', when: 'home only', note: 'the only banner' },
  { label: 'Welcome bell', kind: 'bell', when: 'on first login (any method)', note: 'exactly one' },
  { label: 'Get the SBS app bell', kind: 'bell', when: 'on login', note: 'links to install how-to' },
  { label: 'Founder Draft bell — tomorrow', kind: 'bell', when: 'Tue, first login (if scheduled)' },
  { label: 'Founder Draft bell — today', kind: 'bell', when: 'Wed, first login (if scheduled)' },
  { label: 'First Purchase Bonus bell', kind: 'bell', when: 'after free drafts' },
];
const RET_BEFORE: Row[] = [
  { label: 'First Purchase', kind: 'banner', when: 'home' },
  { label: 'Founder Draft', kind: 'banner', when: 'home + draft, Tue→Wed' },
  { label: 'Get the App', kind: 'banner', when: 'home' },
  { label: 'USDC/Base guide bell', kind: 'bell', when: 'first web3 login' },
  { label: 'First Purchase Bonus bell', kind: 'bell', when: 'when unlocked' },
];
const RET_NOW: Row[] = [
  { label: 'Get the App', kind: 'banner', when: 'home only', note: 'the only banner' },
  { label: 'Get the SBS app bell', kind: 'bell', when: 'on login', note: 'links to install how-to' },
  { label: 'USDC/Base guide bell', kind: 'bell', when: 'first web3 login' },
  { label: 'Founder Draft bell — tomorrow / today', kind: 'bell', when: 'Tue / Wed (if scheduled)' },
  { label: 'First Purchase Bonus bell', kind: 'bell', when: 'when unlocked' },
];

function Pill({ kind }: { kind: 'banner' | 'bell' }) {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${kind === 'banner' ? 'bg-white/10 text-white/60' : 'bg-banana/15 text-banana'}`}>
      {kind}
    </span>
  );
}
function List({ rows }: { rows: Row[] }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {rows.map((r, i) => (
        <div key={i} className={`flex items-center gap-2.5 px-3.5 py-2.5 ${i > 0 ? 'border-t border-white/[0.05]' : ''}`}>
          <Pill kind={r.kind} />
          <div className="flex-1 min-w-0">
            <p className="text-white text-[13px] font-medium">{r.label}{r.note && <span className={`ml-2 text-[10px] font-bold ${r.note === 'DUPLICATE' ? 'text-red-400' : 'text-banana/70'}`}>{r.note}</span>}</p>
            <p className="text-white/40 text-[11.5px]">{r.when}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
function Col({ title, rows, tone }: { title: string; rows: Row[]; tone: 'before' | 'now' }) {
  return (
    <div>
      <p className={`text-[12px] font-semibold uppercase tracking-wider mb-2 ${tone === 'now' ? 'text-banana' : 'text-white/40'}`}>{title}</p>
      <List rows={rows} />
    </div>
  );
}

export default function TestBellFlow() {
  return (
    <div className="min-h-screen bg-[#08090c] px-4 sm:px-8 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-white text-2xl font-bold tracking-tight">Banners → bells: before / after</h1>
        <p className="text-white/45 text-sm mt-1.5 mb-9 leading-relaxed">
          One banner now (Get-the-App, home only). Everything else is a bell — server-backed, real-time, synced across
          mobile + desktop, one per thing (dedupe-keyed). Founder bells fire on the first login of the day before / day of
          the scheduled Wed 6 PM PT draft.
        </p>

        <div className="mb-10">
          <h2 className="text-white text-[15px] font-semibold mb-3">🆕 New user</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Col title="Before" rows={NEW_BEFORE} tone="before" />
            <Col title="Now" rows={NEW_NOW} tone="now" />
          </div>
        </div>

        <div className="mb-10">
          <h2 className="text-white text-[15px] font-semibold mb-3">↩️ Returning user</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Col title="Before" rows={RET_BEFORE} tone="before" />
            <Col title="Now" rows={RET_NOW} tone="now" />
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="text-white/70 text-sm font-medium mb-1">Notes</p>
          <ul className="text-white/45 text-[12.5px] leading-relaxed list-disc pl-4 space-y-1">
            <li>The duplicate welcome bell (fired again on X-verify) is gone — exactly one welcome bell now.</li>
            <li>Founder bells only fire when the founder schedule is <span className="text-white/70">active</span> with a date set.</li>
            <li>Get-the-App is the only banner, and there&apos;s also a one-time app bell linking to the install how-to.</li>
            <li>Everything is deduped, so no user ever gets the same bell twice.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
