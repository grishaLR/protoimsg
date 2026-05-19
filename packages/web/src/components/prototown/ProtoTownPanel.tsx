import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServerMessage } from '@protoimsg/shared';
import { useAuth } from '../../hooks/useAuth';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { WorldEngine } from '../../town/WorldEngine';
import styles from './ProtoTownPanel.module.css';

export function ProtoTownPanel() {
  const { t } = useTranslation('common');
  const { did } = useAuth();
  const { send, subscribe, connected } = useWebSocket();
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WorldEngine | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  // Bumped when an engine finishes initialising — gates the WS-join effect so
  // it runs once the engine is ready, and re-runs when the engine is recreated.
  const [engineEpoch, setEngineEpoch] = useState(0);

  // Engine lifecycle — tied to the authenticated DID. town_leave is sent here
  // (real unmount / DID change), never on a transient reconnect.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !did) return;
    const engine = new WorldEngine();
    engineRef.current = engine;
    engine.onMove = (x, y, dir) => {
      sendRef.current({ type: 'town_move', x, y, dir });
    };
    void engine.init(container, did).then(() => {
      if (engineRef.current === engine) setEngineEpoch((e) => e + 1);
    });
    return () => {
      sendRef.current({ type: 'town_leave' });
      engineRef.current = null;
      engine.destroy();
    };
  }, [did]);

  // Join the town and subscribe to peer events — only once the socket is
  // connected and the engine is ready.
  useEffect(() => {
    if (!connected || engineEpoch === 0) return;
    const engine = engineRef.current;
    if (!engine) return;
    const p = engine.getPosition();
    send({ type: 'town_join', x: p.x, y: p.y, dir: p.dir });
    const unsub = subscribe((msg: ServerMessage) => {
      const e = engineRef.current;
      if (!e) return;
      switch (msg.type) {
        case 'town_state':
          e.setPeers(msg.data.peers);
          break;
        case 'town_peer_join':
          e.peerJoin(msg.data);
          break;
        case 'town_peer_move':
          e.peerMove(msg.data);
          break;
        case 'town_peer_leave':
          e.peerLeave(msg.data.did);
          break;
        case 'town_chat':
          e.showChat(msg.data.did, msg.data.text);
          break;
        default:
          break;
      }
    });
    return () => {
      unsub();
    };
  }, [connected, engineEpoch, subscribe, send]);

  const sendChat = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const text = input.value.trim();
    if (text) send({ type: 'town_chat', text: text.slice(0, 280) });
    input.value = '';
    input.blur();
  }, [send]);

  return (
    <div className={styles.panel}>
      <div className={styles.world} ref={containerRef} />
      <div className={styles.hud}>{t('town.hud.controls')}</div>
      <form
        className={styles.chatBar}
        onSubmit={(e) => {
          e.preventDefault();
          sendChat();
        }}
      >
        <input
          ref={inputRef}
          className={styles.chatInput}
          aria-label={t('town.chat.placeholder')}
          placeholder={t('town.chat.placeholder')}
          maxLength={280}
          onFocus={() => engineRef.current?.setInputEnabled(false)}
          onBlur={() => engineRef.current?.setInputEnabled(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
        />
        <button type="submit" className={styles.chatSend}>
          {t('town.chat.send')}
        </button>
      </form>
    </div>
  );
}
