import { useEffect, useState, type CSSProperties } from 'react';
import { Chev } from '../components/Icons';
import type { PageId, Answers } from '../App';

type Props = {
  setPage: (p: PageId) => void;
  answers: Answers;
  setAnswers: (next: Answers) => void;
};

const GROUP_TYPES   = ['Solo', 'Couple', 'Friends', 'Family with young kids', 'Family with teens', 'Multi-gen'];
const BUDGET_OPTS   = ['Budget-conscious', 'Mid-range', 'Treat yourself', 'Money no object'];
const BUDGET_DESCS: Record<string, string> = {
  'Budget-conscious': 'Free beaches, local spots, cook some meals.',
  'Mid-range':         'A mix of local and resort — ~$100–200/day.',
  'Treat yourself':    'Good restaurants, guided tours, nice hotel.',
  'Money no object':   "The works. Renaissance Island, chef's tables, helicopter.",
};
const INTERESTS = ['Beach & chill', 'Nature & hiking', 'Watersports', 'Food & drink', 'Adventure & adrenaline', 'Culture & history', 'Nightlife', 'Wellness & spa'];
const LODGING_OPTS = ['Palm Beach', 'Eagle Beach', 'Downtown', 'Noord (Airbnb)', 'Cruise', 'Not booked yet', 'Other'];

const LOADING_MESSAGES = [
  'Talking to locals…',
  'Checking weather patterns…',
  'Building your week…',
  'Sorting the best spots…',
  'Avoiding the tourist traps…',
  'Almost ready…',
];

type QuestionId = 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'q6' | 'q7' | 'q8';
type Question = { id: QuestionId; title: string; subtitle?: string };

const QUESTIONS: Question[] = [
  { id: 'q1', title: 'How long is your stay?',           subtitle: 'Drag to set your length. We size every plan around this.' },
  { id: 'q2', title: "Who's with you?",                  subtitle: 'So we pace days for the group.' },
  { id: 'q3', title: "What's your budget vibe?",         subtitle: "We'll match restaurants, activities, and lodging." },
  { id: 'q4', title: 'What energizes you on vacation?',  subtitle: 'Pick up to 3.' },
  { id: 'q5', title: 'Adventure level?',                 subtitle: 'Slide between full chill and full send.' },
  { id: 'q6', title: 'When are you visiting?',           subtitle: "We'll align around weather, tides, and crowds." },
  { id: 'q7', title: 'Where are you staying?',           subtitle: 'Optional — but tells us where your day should start.' },
  { id: 'q8', title: 'Anything we should know?',         subtitle: "Optional. We'll work around it." },
];

export default function Questionnaire({ setPage, answers, setAnswers }: Props) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const total = QUESTIONS.length;
  const q = QUESTIONS[step - 1];

  const update = <K extends keyof Answers>(k: K, v: Answers[K]) => setAnswers({ ...answers, [k]: v });

  const canAdvance = () => {
    if (q.id === 'q1') return answers.days >= 1;
    if (q.id === 'q2') return answers.groupType !== '';
    if (q.id === 'q3') return answers.budget !== '';
    if (q.id === 'q4') return answers.interests.length > 0;
    return true; // q5/q6/q7/q8 always advanceable (have defaults / optional)
  };

  const handleNext = () => {
    if (step < total) { setStep(step + 1); return; }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setPage('itinerary');
    }, 3500);
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="bleed" style={{ background: 'var(--cream)', minHeight: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column' }}>
      {/* Sticky header: back button + progress bar + step counter */}
      <div style={{ position: 'sticky', top: 0, background: 'rgba(255, 251, 240, 0.95)', backdropFilter: 'blur(6px)', borderBottom: '1px solid #E0D9CC', zIndex: 5 }}>
        <div className="container-1280" style={{ padding: '14px 36px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              onClick={() => (step > 1 ? setStep(step - 1) : setPage('landing'))}
              className="btn-ghost"
              style={{ padding: '7px 12px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              ← {step > 1 ? 'Back' : 'Home'}
            </button>
            <div style={{ flex: 1, height: 8, background: 'var(--sand-100)', borderRadius: 999, overflow: 'hidden', border: '2px solid var(--ink)' }}>
              <div style={{ height: '100%', width: `${(step / total) * 100}%`, background: 'var(--red)', transition: 'width 0.35s' }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{step}/{total}</span>
          </div>
        </div>
      </div>

      {/* Question content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '48px 36px' }}>
        <div className="container-1280" style={{ width: '100%', padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h2 className="font-display" style={{ fontSize: 44, textAlign: 'center', margin: '0 0 8px', color: 'var(--ink)', lineHeight: 1, maxWidth: 720 }}>
            {q.title}
          </h2>
          {q.subtitle && (
            <p style={{ fontSize: 15, fontStyle: 'italic', color: 'var(--sand-700)', textAlign: 'center', margin: '0 0 36px', maxWidth: 560 }}>{q.subtitle}</p>
          )}

          <div style={{ width: '100%', maxWidth: 680, display: 'flex', justifyContent: 'center' }}>
            {q.id === 'q1' && <Q1Days  value={answers.days}           onChange={(v) => update('days', v)} />}
            {q.id === 'q2' && <Pills   options={GROUP_TYPES}          value={answers.groupType}     onChange={(v) => update('groupType', v)} />}
            {q.id === 'q3' && <BudgetCards value={answers.budget}     onChange={(v) => update('budget', v)} />}
            {q.id === 'q4' && <MultiPills options={INTERESTS}         value={answers.interests}     onChange={(v) => update('interests', v)} max={3} />}
            {q.id === 'q5' && <Adventure value={answers.adventureLevel} onChange={(v) => update('adventureLevel', v)} />}
            {q.id === 'q6' && <When    value={answers.startOffset}    onChange={(v) => update('startOffset', v)} />}
            {q.id === 'q7' && <Pills   options={LODGING_OPTS}         value={answers.lodging}       onChange={(v) => update('lodging', v)} />}
            {q.id === 'q8' && <AnythingElse value={answers.specialNotes} onChange={(v) => update('specialNotes', v)} />}
          </div>
        </div>
      </div>

      {/* Sticky footer: Next button */}
      <div style={{ position: 'sticky', bottom: 0, background: 'rgba(255, 251, 240, 0.95)', backdropFilter: 'blur(6px)', borderTop: '1px solid #E0D9CC', padding: '16px 0' }}>
        <div className="container-1280" style={{ padding: '0 36px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>
            {step > 4 ? '(this one is optional — skip if you want)' : ''}
          </span>
          <button
            onClick={handleNext}
            disabled={!canAdvance()}
            className="btn-red"
            style={{ padding: '12px 24px', fontSize: 15, opacity: canAdvance() ? 1 : 0.4, cursor: canAdvance() ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {step === total ? 'Build my itinerary →' : 'Continue'}
            {step !== total && <Chev size={14} sw={3} style={{ transform: 'rotate(-90deg)' }} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------- Individual question widgets -------------------- */

function Q1Days({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const pct = ((value - 1) / 13) * 100;
  const label = value === 14 ? '14+ days' : `${value} day${value === 1 ? '' : 's'}`;
  const sliderStyle = { ['--pct' as string]: pct + '%' } as CSSProperties;
  return (
    <div className="chunky" style={{ padding: '28px 32px', width: '100%', maxWidth: 520 }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <span className="font-display" style={{ fontSize: 64, color: 'var(--red)', lineHeight: 0.9, letterSpacing: '-2px' }}>{label}</span>
      </div>
      <input
        type="range" min={1} max={14} value={value}
        className="trip-slider" style={sliderStyle}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Days"
      />
      <div style={{ position: 'relative', height: 18, marginTop: 6, fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
        <span style={{ position: 'absolute', left: '0%' }}>1</span>
        <span style={{ position: 'absolute', left: '15.38%', transform: 'translateX(-50%)' }}>3</span>
        <span style={{ position: 'absolute', left: '30.77%', transform: 'translateX(-50%)' }}>5</span>
        <span style={{ position: 'absolute', left: '46.15%', transform: 'translateX(-50%)' }}>7</span>
        <span style={{ position: 'absolute', left: '69.23%', transform: 'translateX(-50%)' }}>10</span>
        <span style={{ position: 'absolute', right: '0%' }}>14+</span>
      </div>
    </div>
  );
}

function Pills({ options, value, onChange }: { options: readonly string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
      {options.map((opt) => (
        <button key={opt} className={`pill-btn${value === opt ? ' active' : ''}`} onClick={() => onChange(opt)}>
          {opt}
        </button>
      ))}
    </div>
  );
}

function MultiPills({ options, value, onChange, max }: { options: readonly string[]; value: string[]; onChange: (v: string[]) => void; max: number }) {
  const toggle = (opt: string) => {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else if (value.length < max) onChange([...value, opt]);
  };
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
        {options.map((opt) => {
          const isOn = value.includes(opt);
          const isDisabled = !isOn && value.length >= max;
          return (
            <button
              key={opt}
              className={`pill-btn${isOn ? ' active' : ''}${isDisabled ? ' disabled' : ''}`}
              onClick={() => toggle(opt)}
              disabled={isDisabled}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {value.length > 0 && (
        <p style={{ textAlign: 'center', color: 'var(--red)', fontWeight: 700, fontSize: 13, marginTop: 16 }}>{value.length}/{max} selected</p>
      )}
    </div>
  );
}

function BudgetCards({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 460 }}>
      {BUDGET_OPTS.map((b) => {
        const isOn = value === b;
        return (
          <button
            key={b}
            onClick={() => onChange(b)}
            style={{
              textAlign: 'left',
              padding: '16px 18px',
              borderRadius: 14,
              border: '2px solid var(--ink)',
              background: isOn ? 'var(--red)' : 'var(--cream)',
              color: isOn ? 'var(--cream)' : 'var(--ink)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow: '4px 4px 0 var(--ink)',
              transition: 'transform 0.08s',
            }}
            className="pill-btn-card"
          >
            <div className="font-display" style={{ fontSize: 18, marginBottom: 2 }}>{b}</div>
            <div style={{ fontSize: 12.5, opacity: isOn ? 0.95 : 0.65 }}>{BUDGET_DESCS[b]}</div>
          </button>
        );
      })}
    </div>
  );
}

function Adventure({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const pct = value;
  const sliderStyle = { ['--pct' as string]: pct + '%' } as CSSProperties;
  const blurb =
    value < 25 ? "We'll keep it easy. Hammocks and horizon views." :
    value < 50 ? 'A gentle mix — some activity, plenty of chill.' :
    value < 75 ? 'Balanced — mornings active, afternoons unwinding.' :
                 "Full-send. We're scheduling you for the good stuff.";
  return (
    <div className="chunky" style={{ padding: '28px 32px', width: '100%', maxWidth: 560 }}>
      <input type="range" min={0} max={100} value={value} className="trip-slider" style={sliderStyle} onChange={(e) => onChange(Number(e.target.value))} aria-label="Adventure level" />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, gap: 12 }}>
        <div style={{ maxWidth: 160 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: value < 40 ? 'var(--red)' : 'var(--sand-500)' }}>Pure relaxation</div>
          <div style={{ fontSize: 11.5, color: 'var(--sand-500)' }}>Beach reads, spa days, sunset cocktails.</div>
        </div>
        <div style={{ maxWidth: 160, textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: value > 60 ? 'var(--red)' : 'var(--sand-500)' }}>Adrenaline junkie</div>
          <div style={{ fontSize: 11.5, color: 'var(--sand-500)' }}>Kitesurfing, cliff jumps, off-road.</div>
        </div>
      </div>
      <div style={{ marginTop: 18, background: 'var(--sand-50)', border: '2px solid var(--ink)', borderRadius: 12, padding: '12px 14px', textAlign: 'center', fontSize: 13.5, fontWeight: 500 }}>
        {blurb}
      </div>
    </div>
  );
}

function When({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(today);
  target.setDate(target.getDate() + value);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const pct = (value / 30) * 100;
  const sliderStyle = { ['--pct' as string]: pct + '%' } as CSSProperties;
  return (
    <div className="chunky" style={{ padding: '28px 32px', width: '100%', maxWidth: 520 }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <span className="font-display" style={{ fontSize: 52, color: 'var(--red)', lineHeight: 0.9 }}>{fmt(target)}</span>
        <div style={{ fontSize: 13, color: 'var(--sand-500)', marginTop: 6 }}>
          {dayNames[target.getDay()]} · {value === 0 ? 'Today' : value === 1 ? 'Tomorrow' : `${value} days from now`}
        </div>
      </div>
      <input type="range" min={0} max={30} value={value} className="trip-slider" style={sliderStyle} onChange={(e) => onChange(Number(e.target.value))} aria-label="When you start" />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11, color: 'var(--sand-500)' }}>
        <span>Today</span><span>+15 days</span><span>+30 days</span>
      </div>
    </div>
  );
}

function AnythingElse({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="chunky" style={{ padding: '20px 22px', width: '100%', maxWidth: 560 }}>
      <textarea
        maxLength={280}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. shellfish allergy, hate sand, no early mornings, mobility limits, hate crowds…"
        style={{ width: '100%', minHeight: 110, padding: 14, border: '2px solid var(--ink)', borderRadius: 12, fontFamily: 'inherit', fontSize: 14, resize: 'vertical', background: 'var(--cream)', outline: 'none' }}
      />
      <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--sand-500)', marginTop: 6 }}>{value.length}/280</div>
    </div>
  );
}

function LoadingScreen() {
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const t1 = window.setInterval(() => setIdx((i) => (i + 1) % LOADING_MESSAGES.length), 700);
    const t2 = window.setInterval(() => setProgress((p) => Math.min(p + 12, 95)), 450);
    return () => { window.clearInterval(t1); window.clearInterval(t2); };
  }, []);
  return (
    <div className="bleed" style={{ background: 'var(--yellow-bg)', minHeight: 'calc(100vh - 70px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 36 }}>
      <div style={{ textAlign: 'center', maxWidth: 460 }}>
        <div className="spinner" style={{ margin: '0 auto 28px' }} />
        <h2 className="font-display" style={{ fontSize: 38, margin: '0 0 8px', color: 'var(--ink)' }}>Building your plan.</h2>
        <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--red)', minHeight: 24, margin: '0 0 24px', transition: 'all 0.2s' }}>{LOADING_MESSAGES[idx]}</p>
        <div style={{ height: 10, background: 'var(--cream)', border: '2px solid var(--ink)', borderRadius: 999, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: `${progress}%`, background: 'var(--red)', transition: 'width 0.4s' }} />
        </div>
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>Usually takes under 30 seconds.</p>
      </div>
    </div>
  );
}
