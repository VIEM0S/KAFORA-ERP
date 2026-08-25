// Émulateur Firestore Admin SDK minimal, en mémoire, pour tester la logique
// des routes API (transactions, incréments atomiques) sans dépendre de
// l'émulateur Firebase réel (pas disponible dans cet environnement de test).
// Couvre uniquement les opérations utilisées par les routes testées :
// doc(), collection().doc()/.add()/.where().limit().get(), runTransaction()
// avec tx.get/set/update, et la résolution de FieldValue.increment/serverTimestamp.
//
// Atomicité : comme le vrai SDK, tx.set()/tx.update() sont synchrones et ne
// font que mettre en file d'attente l'écriture — rien n'est appliqué au
// store tant que le callback de runTransaction() n'a pas terminé SANS lever
// d'erreur. Si le callback throw, la file est jetée (rollback), exactement
// comme une vraie transaction Firestore.

export const INCREMENT = Symbol('increment');
export const SERVER_TIMESTAMP = Symbol('serverTimestamp');

// Mock du module 'firebase-admin/firestore' — seul FieldValue est utilisé
// par les routes testées.
export const fakeFieldValue = {
  increment: (n: number) => ({ [INCREMENT]: n }),
  serverTimestamp: () => ({ [SERVER_TIMESTAMP]: true }),
};

function resolveWrite(existing: Record<string, unknown>, patch: Record<string, unknown>) {
  const result = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && INCREMENT in (value as object)) {
      const current = Number(result[key]) || 0;
      result[key] = current + (value as { [INCREMENT]: number })[INCREMENT];
    } else if (value && typeof value === 'object' && SERVER_TIMESTAMP in (value as object)) {
      result[key] = new Date();
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class FakeFirestore {
  store = new Map<string, Record<string, unknown>>();

  seed(path: string, data: Record<string, unknown>) {
    this.store.set(path, { ...data });
  }

  read(path: string) {
    return this.store.get(path);
  }

  doc(path: string): FakeDocRef {
    return new FakeDocRef(this, path);
  }

  collection(path: string): FakeCollectionRef {
    return new FakeCollectionRef(this, path);
  }

  /**
   * Requête de groupe de collections : contrairement à collection(path), qui
   * ne lit que les enfants directs d'UN chemin précis, collectionGroup(name)
   * lit tous les documents dont le segment de collection (l'avant-dernier
   * de leur chemin) vaut `name`, quel que soit leur ancêtre — comme le vrai
   * SDK Admin. Nécessaire pour aggregate-daily-stats.mts, qui interroge
   * `sale_items` et `cost_summary` à travers toutes les ventes du jour.
   */
  collectionGroup(name: string): FakeQuery {
    return new FakeQuery(this, null, [], null, name);
  }

  async runTransaction<T>(callback: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const tx = new FakeTransaction(this);
    const result = await callback(tx);
    tx._commit(); // callback n'a pas throw → on applique toutes les écritures en attente
    return result;
    // Si callback throw, on ne passe jamais ici : aucune écriture n'est appliquée (rollback implicite).
  }
}

export class FakeDocRef {
  constructor(private db: FakeFirestore, public path: string) {}
  get id() { return this.path.split('/').pop()!; }

  async get() {
    const data = this.db.read(this.path);
    return {
      exists: data !== undefined,
      id: this.id,
      ref: this,
      data: () => (data ? { ...data } : undefined),
    };
  }

  // Écriture directe (hors transaction) — applique immédiatement.
  async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
    const existing = opts?.merge ? (this.db.read(this.path) || {}) : {};
    this.db.store.set(this.path, resolveWrite(existing, data));
  }

  async update(data: Record<string, unknown>) {
    const existing = this.db.read(this.path) || {};
    this.db.store.set(this.path, resolveWrite(existing, data));
  }

  async delete() {
    this.db.store.delete(this.path);
  }

  /** @internal utilisé par FakeTransaction._commit() pour appliquer une écriture en file d'attente */
  _applyNow(data: Record<string, unknown>) {
    const existing = this.db.read(this.path) || {};
    this.db.store.set(this.path, resolveWrite(existing, data));
  }
}

/**
 * Compare une valeur de document à un filtre.
 *
 * Le simulacre ignorait l'opérateur et testait toujours l'égalité stricte :
 * toute requête `>=` sur une date ne renvoyait donc jamais rien, et les
 * routes qui bornent par période semblaient ne voir aucune donnée. Les tests
 * passaient alors « pour de mauvaises raisons » ou échouaient sans rapport
 * avec le code testé.
 */
function matchFilter(actual: unknown, op: string, expected: unknown): boolean {
  // Dates et Timestamps ramenés à un nombre comparable.
  const norm = (v: unknown): unknown => {
    if (v instanceof Date) return v.getTime();
    if (v && typeof v === 'object' && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
      return ((v as { toDate: () => Date }).toDate()).getTime();
    }
    return v;
  };
  const a = norm(actual);
  const b = norm(expected);

  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '>':  return (a as number) > (b as number);
    case '>=': return (a as number) >= (b as number);
    case '<':  return (a as number) < (b as number);
    case '<=': return (a as number) <= (b as number);
    case 'in': return Array.isArray(expected) && expected.some(v => norm(v) === a);
    default:   return a === b;
  }
}

export class FakeCollectionRef {
  constructor(private db: FakeFirestore, public path: string) {}

  doc(id?: string): FakeDocRef {
    const docId = id || `auto_${Math.random().toString(36).slice(2)}`;
    return new FakeDocRef(this.db, `${this.path}/${docId}`);
  }

  async add(data: Record<string, unknown>) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.db, this.path, [{ field, op, value }]);
  }

  limit(n: number): FakeQuery {
    return new FakeQuery(this.db, this.path, []).limit(n);
  }

  /** Lecture de toute la collection, sans filtre — utilisé par exemple pour
   *  récupérer les lignes d'une vente (sales/{id}/sale_items). */
  async get() {
    return new FakeQuery(this.db, this.path, []).get();
  }

  orderBy(_field: string, _dir?: string): FakeQuery {
    // Le tri n'est pas simulé : les tests n'en dépendent pas, mais la méthode
    // doit exister pour que les chaînes d'appel du code réel fonctionnent.
    return new FakeQuery(this.db, this.path, []);
  }
}

class FakeQuery {
  constructor(
    private db: FakeFirestore,
    private path: string | null,
    private filters: { field: string; op: string; value: unknown }[],
    private limitN: number | null = null,
    private groupName: string | null = null
  ) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.db, this.path, [...this.filters, { field, op, value }], this.limitN, this.groupName);
  }

  limit(n: number): FakeQuery {
    return new FakeQuery(this.db, this.path, this.filters, n, this.groupName);
  }

  async get() {
    let matches: [string, Record<string, unknown>][];
    if (this.groupName !== null) {
      // Groupe de collections : le segment juste avant l'id du document doit
      // correspondre au nom demandé, peu importe le chemin des ancêtres.
      matches = Array.from(this.db.store.entries())
        .filter(([p]) => p.split('/').slice(-2, -1)[0] === this.groupName);
    } else {
      const prefix = `${this.path}/`;
      matches = Array.from(this.db.store.entries())
        .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'));
    }
    matches = matches.filter(([, data]) => this.filters.every(f => matchFilter(data[f.field], f.op, f.value)));
    if (this.limitN !== null) matches = matches.slice(0, this.limitN);
    const docs = matches.map(([p, data]) => ({
      id: p.split('/').pop()!,
      ref: new FakeDocRef(this.db, p),
      data: () => ({ ...data }),
    }));
    // `forEach` et `size` : plusieurs routes parcourent le résultat ainsi
    // plutôt que via `.docs`, comme le vrai QuerySnapshot le permet.
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
      forEach: (cb: (d: (typeof docs)[number]) => void) => docs.forEach(cb),
    };
  }
}

interface PendingWrite {
  ref: FakeDocRef;
  data: Record<string, unknown>;
}

export class FakeTransaction {
  private pendingWrites: PendingWrite[] = [];
  constructor(private db: FakeFirestore) {}

  // Lecture : dans une vraie transaction Firestore, tx.get() voit l'état tel
  // qu'il était au début de la transaction (snapshot isolation). Ce fake lit
  // l'état "live" du store à l'instant de l'appel — suffisant pour les tests
  // ci-contre car ils n'exercent qu'un seul runTransaction() à la fois
  // (appels séquentiels, pas de vraie concurrence JS de toute façon).
  get(ref: FakeDocRef) { return ref.get(); }

  set(ref: FakeDocRef, data: Record<string, unknown>) {
    this.pendingWrites.push({ ref, data });
  }

  update(ref: FakeDocRef, data: Record<string, unknown>) {
    this.pendingWrites.push({ ref, data });
  }

  /** @internal appelé uniquement si le callback n'a pas levé d'exception */
  _commit() {
    for (const w of this.pendingWrites) {
      w.ref._applyNow(w.data);
    }
  }
}
