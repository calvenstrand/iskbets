// THE seeded-selection utility. Every "stable pseudo-random pick" in the
// app (per-ticker lines, tape carry, sweep one-liners, mock history)
// hashes its seed string through here — one implementation, one set of
// avalanche properties, instead of each feature growing its own hash.
//
// FNV-1a over the seed string followed by a murmur3 finalizer. The
// finalizer matters: seeds often share long common substrings (every
// ticker hashed with the same date tail, every snapshot timestamp with
// the same prefix), and without the avalanche the low bits cluster and
// `hash % pool.length` lands many inputs on the same entry.

/** Deterministic 32-bit unsigned hash of a string. SSR-safe: pure,
 * no clock, no randomness — the same seed always hashes the same. */
export function hashString(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The stable pick from `pool` for this seed. Throws on an empty pool —
 * callers own their pools statically, so an empty one is a code bug. */
export function pickSeeded<T>(pool: readonly T[], seed: string): T {
  const item = pool[hashString(seed) % pool.length];
  if (item === undefined) {
    throw new Error("pickSeeded: empty pool");
  }
  return item;
}
