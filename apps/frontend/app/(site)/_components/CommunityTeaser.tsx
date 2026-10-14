/**
 * Community block (Phase P S2 — accounts are live): what an account gets you and
 * a real call to action. Weighting is described honestly: credibility-weighted,
 * so real players are heard over bots and bombs. Title is the section's
 * (admin-editable).
 */
import { label } from '@/lib/labels';

const perks = (): { title: string; body: string }[] =>
  [1, 2, 3].map((n) => ({
    title: label(`home.community.perk${n}.title`),
    body: label(`home.community.perk${n}.body`),
  }));

export function CommunityTeaser({
  title = 'Your voice, with weight',
}: {
  title?: string;
}): React.JSX.Element {
  return (
    <section className="gk-community" aria-label="Community">
      <div className="gk-community-head">
        <span className="gk-eyebrow">{label('home.community.eyebrow')}</span>
        <h2 className="gk-section-title">{title}</h2>
        <p className="gk-section-sub">{label('home.community.sub')}</p>
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
        {perks().map((p) => (
          <div key={p.title} className="gk-community-perk">
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
