/** Upgrade local settings before feature stores are imported. Old databases retain their on-disk names. */
export function migrateBrandStorage(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  ).filter((key): key is string => Boolean(key));
  for (const key of keys) {
    if (!/^liner[_:]/.test(key)) continue;
    const nextKey = key.replace(/^liner/, "amour");
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(nextKey) === null) {
      storage.setItem(
        nextKey,
        value.replaceAll("liner-local://", "amour-local://"),
      );
    }
    // Remove only after the replacement exists: legacy sessions must not reappear after sign-out.
    if (storage.getItem(nextKey) !== null) storage.removeItem(key);
  }
}
