"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * State that survives a reload, without breaking the server render.
 *
 * The obvious version reads localStorage in the useState initialiser. That
 * throws during prerender, and when it does not throw it produces markup on the
 * server that disagrees with the first client render, which React reports as a
 * hydration error and repairs by throwing the server markup away.
 *
 * So the first render always uses the fallback, and the stored value is applied
 * in an effect. The cost is one frame at the default; the benefit is that this
 * works in a statically rendered app.
 */
export function usePersistedState<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored && (allowed as readonly string[]).includes(stored)) {
        setValue(stored as T);
      }
    } catch {
      // Private browsing, or storage disabled. The default is a fine answer.
    }
    setHydrated(true);
    // `allowed` is a literal at every call site; re-running on its identity
    // would loop forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Preference is lost on reload rather than the click doing nothing.
      }
    },
    [key],
  );

  return [value, update, hydrated];
}
