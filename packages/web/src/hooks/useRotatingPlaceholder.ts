import { useEffect, useMemo, useState } from 'react';

function shuffle(arr: readonly string[]): string[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i] ?? '';
    a[i] = a[j] ?? '';
    a[j] = tmp;
  }
  return a;
}

const LOGIN_HANDLES: readonly string[] = [
  'you.selfhosted.social',
  'you.cryptoanarchy.network',
  'you.blacksky.app',
  'you.northsky.social',
  'you.myatproto.social',
  'you.bsky.social',
  'you.graysky.social',
];

const BUDDY_HANDLES: readonly string[] = [
  'friend.bsky.social',
  'friend.blacksky.app',
  'friend.selfhosted.social',
  'friend.northsky.social',
  'friend.myatproto.social',
  'friend.graysky.social',
  'friend.cryptoanarchy.network',
  'sibling.bsky.social',
  'sibling.blacksky.app',
  'sibling.selfhosted.social',
  'sibling.northsky.social',
  'sibling.myatproto.social',
  'sibling.graysky.social',
  'sibling.cryptoanarchy.network',
  'lover.bsky.social',
  'lover.blacksky.app',
  'lover.selfhosted.social',
  'lover.northsky.social',
  'lover.myatproto.social',
  'lover.graysky.social',
  'lover.cryptoanarchy.network',
  'buddy.bsky.social',
  'buddy.blacksky.app',
  'buddy.selfhosted.social',
  'buddy.northsky.social',
  'buddy.myatproto.social',
  'buddy.graysky.social',
  'buddy.cryptoanarchy.network',
  'revolutionary.bsky.social',
  'revolutionary.blacksky.app',
  'revolutionary.selfhosted.social',
  'revolutionary.northsky.social',
  'revolutionary.myatproto.social',
  'revolutionary.graysky.social',
  'revolutionary.cryptoanarchy.network',
];

export function useRotatingPlaceholder(variant: 'login' | 'buddy'): string {
  const source = variant === 'login' ? LOGIN_HANDLES : BUDDY_HANDLES;
  const handles = useMemo(() => shuffle(source), [source]);
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * handles.length));
  useEffect(() => {
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % handles.length);
    }, 3000);
    return () => {
      clearInterval(id);
    };
  }, [handles.length]);
  return handles[idx] ?? handles[0] ?? '';
}
