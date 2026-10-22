import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'bm:night';

/** 3 AM night mode. The class is also applied in main.tsx before first paint, so there is no bright flash. */
export function useNightMode(): [boolean, (value: boolean) => void] {
  const [on, setOn] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');

  useEffect(() => {
    document.documentElement.classList.toggle('night', on);
  }, [on]);

  const set = useCallback((value: boolean) => {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    setOn(value);
  }, []);

  return [on, set];
}
