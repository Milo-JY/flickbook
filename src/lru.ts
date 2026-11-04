/** Map that keeps at most `max` entries and drops the least recently used one (a get counts as a use). */
export class Lru<K, V> {
  private readonly m = new Map<K, V>();
  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const v = this.m.get(key);
    if (v !== undefined) {
      this.m.delete(key);
      this.m.set(key, v);
    }
    return v;
  }

  set(key: K, value: V): void {
    this.m.delete(key);
    this.m.set(key, value);
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as K);
  }

  delete(key: K): void {
    this.m.delete(key);
  }

  /** Keys, least recently used first. */
  keys(): K[] {
    return [...this.m.keys()];
  }
}
