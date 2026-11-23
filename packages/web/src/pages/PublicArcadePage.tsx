import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { API_URL } from '../lib/config';
import { HopperGame } from '../components/games/HopperGame';

// Lazy: Hurdles sits behind HURDLES_ENABLED. With the flag off its chunk is
// never fetched, so users can't hit stale-deploy preload errors for it.
const HurdlesGame = lazy(() =>
  import('../components/games/HurdlesGame').then((m) => ({ default: m.HurdlesGame })),
);
import { ActorChooser } from '../components/games/ActorChooser';
import { ArcadeSignIn } from '../components/games/ArcadeSignIn';
import {
  LeaderboardCol,
  AttributionsCol,
  HURDLES_CREDITS,
  HOPPER_CREDITS,
  type LbEntry,
} from '../components/games/GameLeaderboard';
import {
  GameSelect,
  AVAILABLE_GAMES,
  type Difficulty,
  type GameId,
} from '../components/games/GameSelect';
import styles from './PublicArcadePage.module.css';

type ActiveGame = GameId | null;

export function PublicArcadePage() {
  const { did } = useAuth();
  const [activeGame, setActiveGame] = useState<ActiveGame>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('fast');
  const [selectedDid, setSelectedDid] = useState<string | undefined>();
  const [selectedPds, setSelectedPds] = useState<string | undefined>();
  // Snapshot of the actor at run-start — stays stable through death screen
  const [runDid, setRunDid] = useState<string | undefined>();
  const [runPds, setRunPds] = useState<string | undefined>();
  const [leaderboards, setLeaderboards] = useState<{ fast: LbEntry[]; faster: LbEntry[] }>({
    fast: [],
    faster: [],
  });
  const [handleMap, setHandleMap] = useState<Record<string, string>>({});
  const [showSignIn, setShowSignIn] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [mobilePage, setMobilePage] = useState(1); // 0=Character 1=Play 2=Scores
  const MOBILE_PAGES = ['Character', 'Play', 'Scores'] as const;
  const [pickedGame, setPickedGame] = useState<GameId | null>(null);
  // Side column follows the game being played or looked at; the landing shows
  // the first available game's board.
  const boardGame: GameId = activeGame ?? pickedGame ?? AVAILABLE_GAMES[0] ?? 'hopper';
  const fetchSeqRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLeaderboards = useCallback((game: GameId, signal?: AbortSignal) => {
    // Sequence guard: flipping between games must not let a slow response for
    // the previous game overwrite the board now on screen.
    const seq = ++fetchSeqRef.current;
    Promise.allSettled([
      fetch(`${API_URL}/api/games/leaderboard/${game}_fast`, { signal }).then(
        (r) => r.json() as Promise<{ entries: LbEntry[] }>,
      ),
      fetch(`${API_URL}/api/games/leaderboard/${game}_faster`, { signal }).then(
        (r) => r.json() as Promise<{ entries: LbEntry[] }>,
      ),
    ])
      .then(([fastRes, fasterRes]) => {
        if (signal?.aborted || seq !== fetchSeqRef.current) return;
        setLeaderboards({
          fast: fastRes.status === 'fulfilled' ? fastRes.value.entries : [],
          faster: fasterRes.status === 'fulfilled' ? fasterRes.value.entries : [],
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLeaderboards({ fast: [], faster: [] });
    fetchLeaderboards(boardGame, ac.signal);
    return () => {
      ac.abort();
    };
  }, [boardGame, fetchLeaderboards]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    [],
  );

  // Resolve handles for leaderboard entries
  useEffect(() => {
    const allDids = [...new Set([...leaderboards.fast, ...leaderboards.faster].map((e) => e.did))];
    if (allDids.length === 0) return;
    const ac = new AbortController();
    const qs = allDids.map((d) => `actors=${d}`).join('&');
    fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${qs}`, {
      signal: ac.signal,
    })
      .then((r) => r.json())
      .then((data: { profiles?: { did: string; handle: string; displayName?: string }[] }) => {
        const map: Record<string, string> = {};
        for (const p of data.profiles ?? []) map[p.did] = p.displayName?.trim() || p.handle;
        if (ac.signal.aborted) return;
        // Merge: boards for both games come and go as the viewer flips between them.
        setHandleMap((prev) => ({ ...prev, ...map }));
      })
      .catch(() => {});
    return () => {
      ac.abort();
    };
  }, [leaderboards]);

  const handleScore = useCallback(
    (_score: number, _diff: Difficulty) => {
      // Practice mode — no optimistic leaderboard insert, just re-fetch after delay
      if (!activeGame) return;
      setIsRunning(false);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        fetchLeaderboards(activeGame);
      }, 3000);
    },
    [activeGame, fetchLeaderboards],
  );

  const reset = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setIsRunning(false);
    setActiveGame(null);
    setPickedGame(null);
  };

  const launch = (game: NonNullable<ActiveGame>, diff: Difficulty) => {
    setRunDid(selectedDid);
    setRunPds(selectedPds);
    setIsRunning(true);
    setDifficulty(diff);
    setActiveGame(game);
  };

  const credits = boardGame === 'hopper' ? HOPPER_CREDITS : HURDLES_CREDITS;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.logo}>proto IM arcade</span>
        <div className={styles.headerRight}>
          {did ? (
            <Link to="/" className={styles.openAppLink}>
              proto IM →
            </Link>
          ) : (
            <button
              className={styles.signInBtn}
              type="button"
              onClick={() => {
                setShowSignIn((s) => !s);
              }}
            >
              {showSignIn ? 'cancel' : 'sign in →'}
            </button>
          )}
        </div>
      </header>

      {showSignIn && !did && (
        <div
          className={styles.modalBackdrop}
          onClick={() => {
            setShowSignIn(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={styles.modalWindow}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className={styles.modalTitlebar}>
              <span>Sign in to protoimsg</span>
              <button
                className={styles.modalClose}
                onClick={() => {
                  setShowSignIn(false);
                }}
                type="button"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className={styles.modalBody}>
              <ArcadeSignIn />
            </div>
          </div>
        </div>
      )}

      <div className={styles.practiceBanner}>
        <span className={styles.practiceBannerText}>PRACTICE MODE</span>
        {!did && (
          <>
            <span className={styles.practiceBannerSub}>
              log in to participate in leaderboard and win gifts!
            </span>
            <button
              className={styles.signInBtn}
              type="button"
              onClick={() => {
                setShowSignIn(true);
              }}
            >
              sign in →
            </button>
          </>
        )}
      </div>

      <div className={styles.mobileNav}>
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
        <span className={styles.mobileNavLabel}>{MOBILE_PAGES[mobilePage]}</span>
        <button
          className={styles.mobileNavArrow}
          onClick={() => {
            setMobilePage((p) => Math.min(2, p + 1));
          }}
          disabled={mobilePage === 2}
          type="button"
        >
          ▶
        </button>
      </div>

      <div className={styles.body}>
        {/* Left: actor chooser */}
        <div className={`${styles.side} ${mobilePage !== 0 ? styles.mobileHidden : ''}`}>
          <ActorChooser
            locked={isRunning}
            onSelect={(d, p) => {
              setSelectedDid(d);
              setSelectedPds(p);
              // Between runs: push straight through to the active game so the
              // new character is visible immediately on the death screen
              if (!isRunning) {
                setRunDid(d);
                setRunPds(p);
              }
            }}
          />
        </div>

        {/* Center: game or selection */}
        <div className={`${styles.center} ${mobilePage !== 1 ? styles.mobileHidden : ''}`}>
          {activeGame === 'hurdles' ? (
            <Suspense fallback={<div className={styles.center}>loading…</div>}>
              <HurdlesGame
                did={runDid}
                pds={runPds}
                difficulty={difficulty}
                practiceMode
                onClose={reset}
                onScore={handleScore}
              />
            </Suspense>
          ) : activeGame === 'hopper' ? (
            <HopperGame
              did={runDid}
              pds={runPds}
              difficulty={difficulty}
              practiceMode
              onClose={reset}
              onScore={handleScore}
            />
          ) : (
            <GameSelect game={pickedGame} onPick={setPickedGame} onLaunch={launch} />
          )}
        </div>

        {/* Right: leaderboards + credits */}
        <div className={`${styles.side} ${mobilePage !== 2 ? styles.mobileHidden : ''}`}>
          <span className={styles.lbHeading}>{boardGame} leaderboards</span>
          <LeaderboardCol title="fast" entries={leaderboards.fast} handleMap={handleMap} />
          <LeaderboardCol title="faster" entries={leaderboards.faster} handleMap={handleMap} />
          <AttributionsCol items={credits} />
        </div>
      </div>
    </div>
  );
}
