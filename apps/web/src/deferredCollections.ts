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
