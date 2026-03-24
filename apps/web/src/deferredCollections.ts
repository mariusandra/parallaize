interface IdentifiedRecord {
  id: string;
}

export function canUseDeferredIdentifiedCollection<T extends IdentifiedRecord>(
  current: T[],
  deferred: T[],
): boolean {
  if (current.length !== deferred.length) {
    return false;
  }

  for (let index = 0; index < current.length; index += 1) {
    if (current[index]?.id !== deferred[index]?.id) {
      return false;
    }
  }

  return true;
}

export function orderIdentifiedCollectionByIds<T extends IdentifiedRecord>(
  current: T[],
  orderedIds: string[] | null,
): T[] {
  if (!orderedIds || orderedIds.length === 0) {
    return current;
  }

  const byId = new Map(current.map((entry) => [entry.id, entry]));
  const seenIds = new Set<string>();
  const orderedEntries: T[] = [];

  for (const id of orderedIds) {
    const entry = byId.get(id);

    if (!entry || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    orderedEntries.push(entry);
  }

  for (const entry of current) {
    if (!seenIds.has(entry.id)) {
      orderedEntries.push(entry);
    }
  }

  return orderedEntries.length === current.length &&
      orderedEntries.every((entry, index) => entry.id === current[index]?.id)
    ? current
    : orderedEntries;
}
