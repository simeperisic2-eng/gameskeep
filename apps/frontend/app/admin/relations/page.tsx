import type { Metadata } from 'next';
import { findResource, getMeta, listResource, rowLabel } from '../lib';
import RelationForms from '../_components/RelationForms';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin · Relations', robots: { index: false } };

export default async function RelationsPage() {
  const meta = await getMeta();
  const [topics, subjects, articles] = await Promise.all([
    listResource('topics'),
    listResource('subjects'),
    listResource('articles'),
  ]);
  const topicMeta = findResource(meta, 'topics');
  const subjectMeta = findResource(meta, 'subjects');
  const articleMeta = findResource(meta, 'articles');

  const toOptions = (rows: Record<string, unknown>[], rmeta: ReturnType<typeof findResource>) =>
    rows.map((r) => ({ id: String(r.id), label: rowLabel(rmeta, r) }));

  return (
    <main className="gk-admin">
      <p className="gk-crumbs">
        <a href="/admin">Admin</a> / Relations
      </p>
      <h1 className="gk-title" style={{ fontSize: 24, marginBottom: 6 }}>
        Relations
      </h1>
      <p className="gk-sub">
        Link topics, articles and subjects (games). Exactly one topic can be an article&apos;s
        primary.
      </p>

      <RelationForms
        topics={toOptions(topics, topicMeta)}
        subjects={toOptions(subjects, subjectMeta)}
        articles={toOptions(articles, articleMeta)}
      />
    </main>
  );
}
