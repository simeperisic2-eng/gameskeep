'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';

type Option = { id: string; label: string };

interface Props {
  topics: Option[];
  subjects: Option[];
  articles: Option[];
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function useLink(endpoint: string) {
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(body: Record<string, unknown>, method: 'POST' | 'DELETE') {
    setMsg(null);
    const res = await adminFetch(`/admin/api/relations/${endpoint}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const m =
        json && typeof json === 'object'
          ? ((json as { message?: string }).message ?? 'Failed')
          : 'Failed';
      setMsg(`✗ ${m}`);
      return;
    }
    setMsg(method === 'POST' ? '✓ Linked' : '✓ Unlinked');
  }
  return { msg, submit };
}

export default function RelationForms({ topics, subjects, articles }: Props) {
  const ts = useLink('topic-subject');
  const at = useLink('article-topic');
  const as = useLink('article-subject');

  const [tsTopic, setTsTopic] = useState('');
  const [tsSubject, setTsSubject] = useState('');
  const [atArticle, setAtArticle] = useState('');
  const [atTopic, setAtTopic] = useState('');
  const [atPrimary, setAtPrimary] = useState(true);
  const [asArticle, setAsArticle] = useState('');
  const [asSubject, setAsSubject] = useState('');

  return (
    <div className="gk-relations">
      <section className="gk-card">
        <h2 className="gk-card-title">Topic ↔ Subject</h2>
        <div className="gk-rel-row">
          <Select value={tsTopic} onChange={setTsTopic} options={topics} />
          <Select value={tsSubject} onChange={setTsSubject} options={subjects} />
          <button
            className="gk-btn gk-btn-primary gk-btn-sm"
            onClick={() => ts.submit({ topicId: tsTopic, subjectId: tsSubject }, 'POST')}
          >
            Link
          </button>
          <button
            className="gk-btn gk-btn-sm gk-btn-danger"
            onClick={() => ts.submit({ topicId: tsTopic, subjectId: tsSubject }, 'DELETE')}
          >
            Unlink
          </button>
          {ts.msg ? <span className="gk-rel-msg">{ts.msg}</span> : null}
        </div>
      </section>

      <section className="gk-card">
        <h2 className="gk-card-title">Article ↔ Topic (one primary per article)</h2>
        <div className="gk-rel-row">
          <Select value={atArticle} onChange={setAtArticle} options={articles} />
          <Select value={atTopic} onChange={setAtTopic} options={topics} />
          <label className="gk-inline">
            <input
              type="checkbox"
              checked={atPrimary}
              onChange={(e) => setAtPrimary(e.target.checked)}
            />{' '}
            primary
          </label>
          <button
            className="gk-btn gk-btn-primary gk-btn-sm"
            onClick={() =>
              at.submit({ articleId: atArticle, topicId: atTopic, isPrimary: atPrimary }, 'POST')
            }
          >
            Link
          </button>
          <button
            className="gk-btn gk-btn-sm gk-btn-danger"
            onClick={() => at.submit({ articleId: atArticle, topicId: atTopic }, 'DELETE')}
          >
            Unlink
          </button>
          {at.msg ? <span className="gk-rel-msg">{at.msg}</span> : null}
        </div>
      </section>

      <section className="gk-card">
        <h2 className="gk-card-title">Article ↔ Subject</h2>
        <div className="gk-rel-row">
          <Select value={asArticle} onChange={setAsArticle} options={articles} />
          <Select value={asSubject} onChange={setAsSubject} options={subjects} />
          <button
            className="gk-btn gk-btn-primary gk-btn-sm"
            onClick={() => as.submit({ articleId: asArticle, subjectId: asSubject }, 'POST')}
          >
            Link
          </button>
          <button
            className="gk-btn gk-btn-sm gk-btn-danger"
            onClick={() => as.submit({ articleId: asArticle, subjectId: asSubject }, 'DELETE')}
          >
            Unlink
          </button>
          {as.msg ? <span className="gk-rel-msg">{as.msg}</span> : null}
        </div>
      </section>
    </div>
  );
}
