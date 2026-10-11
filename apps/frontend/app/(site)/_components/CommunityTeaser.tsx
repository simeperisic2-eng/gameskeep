/**
 * Community block (Phase P S2 — accounts are live): what an account gets you and
 * a real call to action. Weighting is described honestly: credibility-weighted,
 * so real players are heard over bots and bombs. Title is the section's
 * (admin-editable).
 */
const PERKS: { title: string; body: string }[] = [
  { title: 'Rate every game', body: 'Add your score to the community line — weighted, not gamed.' },
  { title: 'Vote in the Awards', body: 'Have a say in Community Choice across every category.' },
  {
    title: 'Build your profile',
    body: 'Earn a level and badges as your takes prove out over time.',
  },
];

export function CommunityTeaser({
  title = 'Your voice, with weight',
}: {
  title?: string;
}): React.JSX.Element {
  return (
    <section className="gk-community" aria-label="Community">
      <div className="gk-community-head">
        <span className="gk-eyebrow">Community</span>
        <h2 className="gk-section-title">{title}</h2>
        <p className="gk-section-sub">
          Rate games, vote in the Awards and follow the stories you care about. Every vote is
          weighted for credibility, so real players are heard over bots and bombs.
        </p>
        <div className="gk-community-cta">
          <a className="gk-btn-amber" href="/register">
            Create a free account
          </a>
          <a className="gk-readlink" href="/login">
            Sign in
          </a>
        </div>
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
