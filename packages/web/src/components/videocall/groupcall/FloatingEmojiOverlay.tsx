import type { FloatingEmoji } from './types';

/** Absolutely-positioned layer that animates reaction emojis floating upward. */
export function FloatingEmojiOverlay({ emojis }: { emojis: FloatingEmoji[] }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      {emojis.map((e) => (
        <span
          key={e.id}
          style={{
            position: 'absolute',
            left: `${e.x}%`,
            bottom: 0,
            fontSize: '2rem',
            animation: 'groupCallEmojiFloat 2.5s ease-out forwards',
            pointerEvents: 'none',
          }}
        >
          {e.emoji}
        </span>
      ))}
    </div>
  );
}
