// Injectable storage boundary. Production uses Firestore transactions; tests use
// an isolated serializable in-memory implementation with rollback on exceptions.
export class MemoryStore {
  constructor(seed = {}) { this.data = structuredClone(seed); this.tail = Promise.resolve(); }
  async transact(work) {
    const run = this.tail.then(async () => {
      const next = structuredClone(this.data);
      const result = await work({ get: async path => structuredClone(next[path]), set: (path, value) => { next[path] = structuredClone(value); }, delete: path => { delete next[path]; } });
      this.data = next; return result;
    });
    this.tail = run.catch(() => {}); return run;
  }
  async list(collection, field, value) {
    await this.tail;
    return Object.entries(this.data).filter(([p, d]) => p.startsWith(`${collection}/`) && p.split('/').length === 2 && (!field || d[field] === value)).map(([, d]) => structuredClone(d));
  }
}
export class FirestoreStore {
  constructor(db) { this.db = db; }
  transact(work) {
    return this.db.runTransaction(tx => work({
      get: async path => { const snap = await tx.get(this.db.doc(path)); return snap.exists ? snap.data() : undefined; },
      set: (path, value) => tx.set(this.db.doc(path), value),
      delete: path => tx.delete(this.db.doc(path)),
    }));
  }
  async list(collection, field, value) {
    const query = field ? this.db.collection(collection).where(field, '==', value) : this.db.collection(collection);
    return (await query.limit(100).get()).docs.map(doc => doc.data());
  }
}
