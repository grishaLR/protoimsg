import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDragResize } from '../../hooks/useDragResize';
import type { ProximityVideo } from '../../town/ProximityVoice';
import { TownVideoTile } from './TownVideoTile';
import styles from './TownVideoWindow.module.css';

interface TownVideoWindowProps {
  videos: ProximityVideo[];
  /** Whether a feed is showing (yours always; others once revealed). */
  isRevealed: (video: ProximityVideo) => boolean;
  onToggleReveal: (key: string) => void;
}

const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
const EDGE_CLASS: Record<(typeof EDGES)[number], string | undefined> = {
  n: styles.resizeN,
  s: styles.resizeS,
  e: styles.resizeE,
  w: styles.resizeW,
  ne: styles.resizeNE,
  nw: styles.resizeNW,
  se: styles.resizeSE,
  sw: styles.resizeSW,
};

/**
 * Floating window for the camera feeds in your proximity conversation.
 * Drag it by the title bar, resize from any edge or corner (same behaviour
 * as DM popovers), or collapse it to just the title bar.
 */
export function TownVideoWindow({ videos, isRevealed, onToggleReveal }: TownVideoWindowProps) {
  const { t } = useTranslation('common');
  const [collapsed, setCollapsed] = useState(false);
  const {
    containerRef,
    posStyle,
    sizeStyle,
    onDragStart,
    onPointerMove,
    onPointerUp,
    onResizeStart,
  } = useDragResize({ minWidth: 200, minHeight: 120, enabled: true });

  return (
    <div
      ref={containerRef}
      className={`${styles.window} ${collapsed ? styles.collapsed : ''}`}
      style={{ ...posStyle, ...(collapsed ? {} : sizeStyle) }}
      role="group"
      aria-label={t('town.voice.videoStrip')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {!collapsed &&
        EDGES.map((edge) => (
          <div
            key={edge}
            className={`${styles.resizeHandle} ${EDGE_CLASS[edge] ?? ''}`}
            onPointerDown={(e) => {
              onResizeStart(edge, e);
            }}
          />
        ))}
      <div
        className={styles.titleBar}
        onPointerDown={(e) => {
          // Buttons in the bar stay clickable.
          if ((e.target as HTMLElement).closest('button')) return;
          onDragStart(e);
        }}
      >
        <span className={styles.title}>{t('town.voice.videoTitle', { count: videos.length })}</span>
        <button
          type="button"
          className={styles.titleButton}
          aria-expanded={!collapsed}
          onClick={() => {
            setCollapsed((c) => !c);
          }}
        >
          {collapsed ? t('town.voice.expandVideo') : t('town.voice.collapseVideo')}
        </button>
      </div>
      {!collapsed && (
        <div className={styles.grid}>
          {videos.map((v) => (
            <TownVideoTile
              key={v.key}
              video={v}
              revealed={isRevealed(v)}
              onToggleReveal={onToggleReveal}
            />
          ))}
        </div>
      )}
    </div>
  );
}
