import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findResource, getMeta, listResource, rowLabel } from '../lib';
import RowActions from '../_components/RowActions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false } };

interface Props {
  params: Promise<{ resource: string }>;
}

export default async function ResourceList({ params }: Props) {
  const { resource } = await params;
  // `new` is the create route, handled by [id]/page.tsx — never list it.
  if (resource === 'new') notFound();

  const meta = await getMeta();
  const rmeta = findResource(meta, resource);
  if (!rmeta) notFound();

  const rows = await listResource(resource);

  return (
    <main className="gk-admin">
      <p className="gk-crumbs">
        <a href="/admin">Admin</a> / {rmeta.label}
      </p>
      <header className="gk-admin-head">
        <h1 className="gk-title" style={{ fontSize: 26 }}>
          {rmeta.label} <span className="gk-count">({rows.length})</span>
        </h1>
        <a className="gk-btn gk-btn-primary" href={`/admin/${resource}/new`}>
          + New
        </a>
      </header>

      {rows.length === 0 ? (
        <div className="gk-card">No rows yet. Use “+ New” to create one.</div>
      ) : (
        <div className="gk-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="gk-table">
            <thead>
              <tr>
                <th>{rmeta.labelColumn}</th>
                <th>id</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = String(row.id);
                return (
                  <tr key={id}>
                    <td>{rowLabel(rmeta, row)}</td>
                    <td className="gk-mono">{id}</td>
                    <td style={{ textAlign: 'right' }}>
                      <RowActions resource={resource} id={id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
