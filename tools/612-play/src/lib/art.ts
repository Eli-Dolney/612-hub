import { useEffect, useState } from "react";
import { getOne } from "./db";
import { cachedObjectUrl } from "./color";

const mem = new Map<string, string | null>();
const waiters = new Map<string, Promise<string | null>>();

export async function artUrl(id?: string | null) {
  if (!id) return null;
  if (mem.has(id)) return mem.get(id)!;
  const pending = waiters.get(id);
  if (pending) return pending;
  const p = getOne("arts", id).then((row) => {
    const url = row ? cachedObjectUrl(id, row.blob) : null;
    mem.set(id, url);
    waiters.delete(id);
    return url;
  });
  waiters.set(id, p);
  return p;
}

export function useArt(id?: string | null) {
  const [url, setUrl] = useState<string | undefined>(() => (id && mem.get(id)) || undefined);
  useEffect(() => {
    let live = true;
    if (!id) {
      setUrl(undefined);
      return;
    }
    const hit = mem.get(id);
    if (hit) {
      setUrl(hit);
      return;
    }
    artUrl(id).then((u) => {
      if (live) setUrl(u || undefined);
    });
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}
