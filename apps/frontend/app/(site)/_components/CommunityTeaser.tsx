/**
 * Community teaser (honest anticipation, NOT a real CTA). Accounts, rating,
 * voting and profiles arrive in I6 — clicking a "rate it" button now would hit a
 * wall, so this block builds anticipation truthfully instead of lying. It pairs
 * with the newsletter capture (the one thing that DOES work today).
 */
const PERKS: { title: string; body: string }[] = [
  { title: 'Rate every game', body: 'Add your score to the community line — weighted, not gamed.' },
  { title: 'Vote in the Awards', body: 'Have a say in Community Choice across every category.' },
  {
    title: 'Build your profile',
    body: 'Earn a level and badges as your takes prove out over time.',
  },
];

export function CommunityTeaser(): React.JSX.Element {
  return (
    <section className="gk-community" aria-label="Community — coming soon">
      <div className="gk-community-head">
        <span className="gk-eyebrow">Coming soon</span>
        <h2 className="gk-section-title">Your voice, with weight</h2>
        <p className="gk-section-sub">
          Accounts arrive soon. When they do, your ratings and votes count — with anti-manipulation
          weighting so real players are heard over bots and bombs.
        </p>
      </div>
      <div className="gk-community-perks">
        {PERKS.map((p) => (
          <div key={p.title} className="gk-community-perk">
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
