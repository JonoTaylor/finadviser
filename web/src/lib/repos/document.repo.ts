import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { documents } = schema;

export type DocumentKind = (typeof schema.documentKindEnum.enumValues)[number];

/** Schema-inferred row shape (includes the BYTEA content). */
export type DocumentRow = typeof documents.$inferSelect;

/** Listing/preview shape — no binary content, safe to serialise to JSON. */
export type DocumentMeta = Omit<DocumentRow, 'content'>;

export interface DocumentInput {
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  content: Buffer;
  propertyId?: number | null;
  tenancyId?: number | null;
  notes?: string | null;
}

const META_COLUMNS = {
  id: documents.id,
  kind: documents.kind,
  filename: documents.filename,
  mimeType: documents.mimeType,
  sizeBytes: documents.sizeBytes,
  sha256: documents.sha256,
  propertyId: documents.propertyId,
  tenancyId: documents.tenancyId,
  notes: documents.notes,
  uploadedAt: documents.uploadedAt,
};

export const documentRepo = {
  async create(input: DocumentInput): Promise<DocumentMeta> {
    const db = getDb();
    const [row] = await db
      .insert(documents)
      .values({
        kind: input.kind,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        content: input.content,
        propertyId: input.propertyId ?? null,
        tenancyId: input.tenancyId ?? null,
        notes: input.notes ?? null,
      })
      .returning(META_COLUMNS);
    return row;
  },

  async list(): Promise<DocumentMeta[]> {
    const db = getDb();
    return db.select(META_COLUMNS).from(documents).orderBy(desc(documents.uploadedAt));
  },

  async getMeta(id: number): Promise<DocumentMeta | null> {
    const db = getDb();
    const [row] = await db.select(META_COLUMNS).from(documents).where(eq(documents.id, id));
    return row ?? null;
  },

  async getBySha256(sha256: string): Promise<DocumentMeta | null> {
    const db = getDb();
    const [row] = await db.select(META_COLUMNS).from(documents).where(eq(documents.sha256, sha256));
    return row ?? null;
  },

  async getContent(id: number): Promise<{ meta: DocumentMeta; content: Buffer } | null> {
    const db = getDb();
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    if (!row) return null;
    const { content, ...meta } = row;
    // Neon returns BYTEA as Buffer (Node) or Uint8Array — normalise.
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    return { meta, content: buf };
  },

  async linkTenancy(id: number, tenancyId: number): Promise<DocumentMeta | null> {
    const db = getDb();
    const [row] = await db
      .update(documents)
      .set({ tenancyId })
      .where(eq(documents.id, id))
      .returning(META_COLUMNS);
    return row ?? null;
  },

  async setProperty(id: number, propertyId: number | null): Promise<DocumentMeta | null> {
    const db = getDb();
    const [row] = await db
      .update(documents)
      .set({ propertyId })
      .where(eq(documents.id, id))
      .returning(META_COLUMNS);
    return row ?? null;
  },

  async delete(id: number): Promise<void> {
    const db = getDb();
    await db.delete(documents).where(eq(documents.id, id));
  },
};
