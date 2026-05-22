import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParticipants } from '@livekit/components-react';
import { Check, Copy, ExternalLink, Mail, Share2, Users, X } from 'lucide-react';
import styles from '../VideoCallOverlay.module.css';

interface CallHeaderProps {
  meetCode: string;
  onLeave: () => void;
  /** Drag handle — the header is the grab area for the floating window. */
  onDragStart: (e: React.PointerEvent) => void;
}

/** Title bar: participant count, share menu, hang-up. Also the drag handle. */
export const CallHeader = memo(function CallHeader({
  meetCode,
  onLeave,
  onDragStart,
}: CallHeaderProps) {
  const { t } = useTranslation('common');
  const participants = useParticipants();

  const [showShareMenu, setShowShareMenu] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Close the share menu on any outside click (the timeout skips the opening click).
  useEffect(() => {
    if (!showShareMenu) return;
    const close = () => {
      setShowShareMenu(false);
    };
    const timer = setTimeout(() => {
      document.addEventListener('click', close);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', close);
    };
  }, [showShareMenu]);

  const meetUrl = meetCode ? `${window.location.origin}/meet/${meetCode}` : '';
  const shareText = meetCode ? `Join my protoimsg video call: ${meetUrl}` : '';

  const copyMeetCode = useCallback(() => {
    if (!meetUrl) return;
    void navigator.clipboard.writeText(meetUrl);
    setCodeCopied(true);
    setShowShareMenu(false);
    setTimeout(() => {
      setCodeCopied(false);
    }, 2000);
  }, [meetUrl]);

  const shareViaEmail = useCallback(() => {
    if (!shareText) return;
    window.open(
      `mailto:?subject=${encodeURIComponent('Join my video call')}&body=${encodeURIComponent(shareText)}`,
    );
    setShowShareMenu(false);
  }, [shareText]);

  const shareViaBluesky = useCallback(() => {
    if (!shareText) return;
    window.open(`https://bsky.app/intent/compose?text=${encodeURIComponent(shareText)}`, '_blank');
    setShowShareMenu(false);
  }, [shareText]);

  const menuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 10px',
    background: 'none',
    border: 'none',
    color: 'var(--cm-chrome-text)',
    cursor: 'pointer',
    borderRadius: 4,
    fontSize: 'var(--cm-text-sm)',
    textAlign: 'left',
  };

  return (
    <div
      className={styles.header}
      onPointerDown={onDragStart}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <span className={styles.headerIdentity}>
        <Users size={14} style={{ marginRight: 4, display: 'inline' }} />
        {t('videoCall.groupCall', { defaultValue: 'Group Call' })} ({participants.length})
      </span>
      {meetCode && (
        <div
          style={{ position: 'relative' }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
        >
          <button
            onClick={() => {
              setShowShareMenu((v) => !v);
            }}
            title={codeCopied ? 'Copied!' : 'Share meeting'}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 'var(--cm-text-sm)',
              opacity: 0.8,
              padding: '0 4px',
            }}
          >
            <span style={{ fontFamily: 'monospace' }}>{meetCode}</span>
            {codeCopied ? <Check size={12} /> : <Share2 size={12} />}
          </button>
          {showShareMenu && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                background: 'var(--cm-titlebar)',
                border: '1px solid var(--cm-chrome-hover)',
                borderRadius: 8,
                padding: 4,
                minWidth: 180,
                zIndex: 20,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            >
              <button onClick={copyMeetCode} style={menuItemStyle}>
                <Copy size={14} /> Copy link
              </button>
              <button onClick={shareViaEmail} style={menuItemStyle}>
                <Mail size={14} /> Share via email
              </button>
              <button onClick={shareViaBluesky} style={menuItemStyle}>
                <ExternalLink size={14} /> Share via Bluesky
              </button>
            </div>
          )}
        </div>
      )}
      <button
        className={styles.headerHangUp}
        onClick={onLeave}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        title={t('videoCall.endCall')}
        aria-label={t('videoCall.endCall')}
      >
        <X size={16} />
      </button>
    </div>
  );
});
