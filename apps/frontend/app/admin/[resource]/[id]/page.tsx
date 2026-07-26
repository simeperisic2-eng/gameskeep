import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findResource, getMeta, getResourceRow, listResource, rowLabel, type Row } from '../../lib';
import ResourceForm from '../../_components/ResourceForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false } };

interface Props {
  params: Promise<{ resource: string; id: string }>;
}

export default async function ResourceEdit({ params }: Props) {
  const { resource, id } = await params;
  const meta = await getMeta();
  const rmeta = findResource(meta, resource);
  if (!rmeta) notFound();

  const mode = id === 'new' ? 'create' : 'edit';
  let initial: Row = {};
  if (mode === 'edit') {
    const row = await getResourceRow(resource, id);
    if (!row) notFound();
    initial = row;
  }

  // Build dropdown options for every `ref` field (id → friendly label).
  const refOptions: Record<string, { id: string; label: string }[]> = {};
  for (const field of rmeta.fields) {
    if (field.type === 'ref' && field.ref) {
      const refMeta = findResource(meta, field.ref);
      const rows = await listResource(field.ref);
      refOptions[field.name] = rows.map((r) => ({ id: String(r.id), label: rowLabel(refMeta, r) }));
    }
  }

  return (
    <main className="gk-admin">
      <p className="gk-crumbs">
        <a href="/admin">Admin</a> / <a href={`/admin/${resource}`}>{rmeta.label}</a> /{' '}
        {mode === 'create' ? 'New' : 'Edit'}
      </p>
      <h1 className="gk-title" style={{ fontSize: 24, marginBottom: 18 }}>
        {mode === 'create' ? `New ${rmeta.label}` : `Edit ${rmeta.label}`}
      </h1>

      <div className="gk-card">
        <ResourceForm
          resource={resource}
          mode={mode}
          id={mode === 'edit' ? id : undefined}
          fields={rmeta.fields}
          initial={initial}
          refOptions={refOptions}
        />
      </div>
    </main>
  );
}
