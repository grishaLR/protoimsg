import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { resolvePdsForDid } from '../../lib/resolve-pds';
import { API_URL, RUNNER_ENABLED } from '../../lib/config';
import { RunnerGame } from './RunnerGame';
import { JumperGame } from './JumperGame';
import {
  LeaderboardCol,
  StatsCol,
  AttributionsCol,
  RUNNER_CREDITS,
  JUMPER_CREDITS,
  type LbEntry,
  type GameStats,
  EMPTY_STATS,
} from './GameLeaderboard';
import styles from './GamesPanel.module.css';

type ActiveGame = 'runner' | 'jumper' | null;
export type Difficulty = 'fast' | 'faster';

export function GamesPanel() {
  const { did, agent } = useAuth();
  const [activeGame, setActiveGame] = useState<ActiveGame>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('fast');
  const [mobilePage, setMobilePage] = useState(0); // 0=Game 1=Scores
  const [previewGame, setPreviewGame] = useState<'runner' | 'jumper'>('jumper');
  const [previewKey, setPreviewKey] = useState(0);
  const [leaderboards, setLeaderboards] = useState<{ fast: LbEntry[]; faster: LbEntry[] }>({
    fast: [],
    faster: [],
  });
  const [handleMap, setHandleMap] = useState<Record<string, string>>({});
  const [gameStats, setGameStats] = useState<{ fast: GameStats; faster: GameStats }>({
    fast: EMPTY_STATS,
    faster: EMPTY_STATS,
  });

  const { data: pds } = useQuery({
    queryKey: ['pds', did],
    enabled: !!did,
    staleTime: 60 * 60 * 1000,
    queryFn: () => resolvePdsForDid(did as string),
  });

  const fetchGameStats = useCallback(
    (game: NonNullable<ActiveGame>) => {
      if (!agent || !did) return;
      agent.com.atproto.repo
        .getRecord({ repo: did, collection: 'actor.rpg.stats', rkey: 'self' })
        .then((res) => {
          const gd = (res.data.value as Record<string, unknown> | undefined)?.[game] as
            | Record<string, unknown>
            | undefined;
          const fast = gd?.fast as GameStats | undefined;
          const faster = gd?.faster as GameStats | undefined;
          setGameStats({ fast: fast ?? EMPTY_STATS, faster: faster ?? EMPTY_STATS });
        })
        .catch(() => {
          setGameStats({ fast: EMPTY_STATS, faster: EMPTY_STATS });
        });
    },
    [agent, did],
  );

  useEffect(() => {
    if (!activeGame) return;
    fetchGameStats(activeGame);
  }, [activeGame, fetchGameStats]);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLeaderboards = useCallback((game: NonNullable<ActiveGame>) => {
    Promise.allSettled([
      fetch(`${API_URL}/api/games/leaderboard/${game}_fast`).then(
        (r) => r.json() as Promise<{ entries: LbEntry[] }>,
      ),
      fetch(`${API_URL}/api/games/leaderboard/${game}_faster`).then(
        (r) => r.json() as Promise<{ entries: LbEntry[] }>,
      ),
    ])
      .then(([fastRes, fasterRes]) => {
        setLeaderboards({
          fast: fastRes.status === 'fulfilled' ? fastRes.value.entries : [],
          faster: fasterRes.status === 'fulfilled' ? fasterRes.value.entries : [],
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeGame) return;
    fetchLeaderboards(activeGame);
  }, [activeGame, fetchLeaderboards]);

  useEffect(() => {
    const allDids = [...new Set([...leaderboards.fast, ...leaderboards.faster].map((e) => e.did))];
    if (allDids.length === 0) return;
    const qs = allDids.map((d) => `actors=${d}`).join('&');
    fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${qs}`)
      .then((r) => r.json())
      .then((data: { profiles?: { did: string; handle: string; displayName?: string }[] }) => {
        const map: Record<string, string> = {};
        for (const p of data.profiles ?? []) map[p.did] = p.displayName?.trim() || p.handle;
        setHandleMap(map);
      })
      .catch(() => {});
  }, [leaderboards]);

  useEffect(() => {
    setMobilePage(0);
  }, [activeGame]);

  const reset = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setActiveGame(null);
    setLeaderboards({ fast: [], faster: [] });
    setHandleMap({});
    setGameStats({ fast: EMPTY_STATS, faster: EMPTY_STATS });
  };

  const launch = (game: NonNullable<ActiveGame>, diff: Difficulty) => {
    setDifficulty(diff);
    setActiveGame(game);
  };

  const handleScore = useCallback(
    (score: number, diff: Difficulty) => {
      if (!did || !activeGame) return;

      // Optimistically insert player's score into the played difficulty's leaderboard
      setLeaderboards((prev) => {
        const board = prev[diff];
        const alreadyOn = board.some((e) => e.did === did);
        const without = board.filter((e) => e.did !== did);
        const updated = [...without, { did, score }].sort((a, b) => b.score - a.score).slice(0, 5);
        // Only update if player makes/improves their spot on this board
        if (!alreadyOn && !updated.some((e) => e.did === did)) return prev;
        return { ...prev, [diff]: updated };
      });

      // Re-fetch leaderboards + stats after 3s to confirm server data
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        fetchLeaderboards(activeGame);
        fetchGameStats(activeGame);
      }, 3000);
    },
    [did, activeGame, fetchLeaderboards, fetchGameStats],
  );

  const mobileNav = (
    <div className={styles.mobileNav}>
      <button className={styles.mobileBack} onClick={reset} type="button">
        ← back
      </button>
      <div className={styles.mobileNavPages}>
        <button
          className={styles.mobileNavArrow}
          onClick={() => {
            setMobilePage((p) => Math.max(0, p - 1));
          }}
          disabled={mobilePage === 0}
          type="button"
        >
          ◀
        </button>
        <span className={styles.mobileNavLabel}>{['Game', 'Scores'][mobilePage]}</span>
        <button
          className={styles.mobileNavArrow}
          onClick={() => {
            setMobilePage((p) => Math.min(1, p + 1));
          }}
          disabled={mobilePage === 1}
          type="button"
        >
          ▶
        </button>
      </div>
    </div>
  );

  if (activeGame && (!did || !pds)) {
    return (
      <div className={styles.panel}>
        <div className={styles.loading}>loading…</div>
      </div>
    );
  }

  if (activeGame === 'runner' && did && pds) {
    return (
      <div className={`${styles.panel} ${styles.gameActive}`}>
        {mobileNav}
        <div className={styles.gameCol}>
          <div className={`${styles.gameWrap} ${mobilePage !== 0 ? styles.mobileHidden : ''}`}>
            <RunnerGame
              did={did}
              pds={pds}
              difficulty={difficulty}
              onClose={reset}
              onScore={handleScore}
            />
          </div>
          <div className={`${styles.lbBelow} ${mobilePage !== 1 ? styles.mobileHidden : ''}`}>
            <span className={styles.lbHeading}>leaderboards</span>
            <div className={styles.lbRow}>
              <LeaderboardCol
                title="fast"
                entries={leaderboards.fast}
                viewerDid={did}
                handleMap={handleMap}
              />
              <LeaderboardCol
                title="faster"
                entries={leaderboards.faster}
                viewerDid={did}
                handleMap={handleMap}
              />
              <StatsCol stats={gameStats} />
            </div>
            <AttributionsCol items={RUNNER_CREDITS} />
          </div>
        </div>
      </div>
    );
  }

  if (activeGame === 'jumper' && did && pds) {
    return (
      <div className={`${styles.panel} ${styles.gameActive}`}>
        {mobileNav}
        <div className={styles.gameRow}>
          <div className={`${styles.lbSide} ${mobilePage !== 1 ? styles.mobileHidden : ''}`}>
            <AttributionsCol items={JUMPER_CREDITS} />
          </div>
          <div className={`${styles.gameWrap} ${mobilePage !== 0 ? styles.mobileHidden : ''}`}>
            <JumperGame
              did={did}
              pds={pds}
              difficulty={difficulty}
              onClose={reset}
              onScore={handleScore}
            />
          </div>
          <div className={`${styles.lbSide} ${mobilePage !== 1 ? styles.mobileHidden : ''}`}>
            <span className={styles.lbHeading}>leaderboards</span>
            <LeaderboardCol
              title="fast"
              entries={leaderboards.fast}
              viewerDid={did}
              handleMap={handleMap}
            />
            <LeaderboardCol
              title="faster"
              entries={leaderboards.faster}
              viewerDid={did}
              handleMap={handleMap}
            />
            <StatsCol stats={gameStats} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Fun</h2>
      <div className={styles.previewWrap}>
        {RUNNER_ENABLED && (
          <div className={styles.previewTabs}>
            <button
              className={`${styles.previewTab} ${previewGame === 'runner' ? styles.previewTabActive : ''}`}
              onClick={() => {
                setPreviewGame('runner');
                setPreviewKey((k) => k + 1);
              }}
              type="button"
            >
              runner
            </button>
            <button
              className={`${styles.previewTab} ${previewGame === 'jumper' ? styles.previewTabActive : ''}`}
              onClick={() => {
                setPreviewGame('jumper');
                setPreviewKey((k) => k + 1);
              }}
              type="button"
            >
              jumper
            </button>
          </div>
        )}
        <div className={styles.previewCanvas}>
          {previewGame === 'runner' ? (
            <RunnerGame
              key={`preview-runner-${previewKey}`}
              did={did ?? undefined}
              pds={pds ?? undefined}
              difficulty="fast"
              onClose={() => {
                setPreviewKey((k) => k + 1);
              }}
              onScore={() => {
                setPreviewKey((k) => k + 1);
              }}
            />
          ) : (
            <JumperGame
              key={`preview-jumper-${previewKey}`}
              did={did ?? undefined}
              pds={pds ?? undefined}
              difficulty="fast"
              onClose={() => {
                setPreviewKey((k) => k + 1);
              }}
              onScore={() => {
                setPreviewKey((k) => k + 1);
              }}
            />
          )}
          <div className={styles.diffOverlay}>
            <span className={styles.diffOverlayGame}>{previewGame}</span>
            <span className={styles.diffOverlayHint}>choose difficulty</span>
            <div className={styles.diffBtns}>
              <button
                className={styles.diffBtn}
                onClick={() => {
                  launch(previewGame, 'fast');
                }}
                type="button"
              >
                fast
              </button>
              <button
                className={styles.diffBtn}
                onClick={() => {
                  launch(previewGame, 'faster');
                }}
                type="button"
              >
                faster
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
