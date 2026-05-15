import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { resolvePdsForDid } from '../../lib/resolve-pds';
import { API_URL } from '../../lib/config';
import { RunnerGame } from './RunnerGame';
import { JumperGame } from './JumperGame';
import styles from './GamesPanel.module.css';

// game-icons.net — CC BY 3.0, authors: lorc, skoll
const GAME_ICON_PATHS = {
  run: 'M372.97 24.938c-8.67.168-17.816 3.644-26.69 10.28-12.618 9.44-24.074 25.203-30.5 44.844-6.424 19.642-6.48 39.12-1.874 54.157 4.608 15.036 13.375 25.225 24.97 29 11.593 3.772 24.724.72 37.343-8.72 12.618-9.44 24.074-25.234 30.5-44.875 6.424-19.642 6.512-39.12 1.905-54.156-4.607-15.038-13.404-25.196-25-28.97a32.051 32.051 0 0 0-8.938-1.563c-.573-.018-1.14-.01-1.718 0zm-155.69 69.78c-21.696.024-43.394 2.203-65.093 7.094-24.91 29.824-43.848 60.255-52.875 98.47l37.376 17.812c8.273-30.735 21.485-53.817 43.375-77 22.706-7.844 45.418-6.237 68.125 1.5-74.24 65.137-51.17 120.676-80.344 226.47-42.653 17.867-85.098 20.53-123.25-.002L23 415.625c59.418 27.09 125.736 29.818 190.844 0 20.368-43.443 27.214-88.603 25-132.906C295.31 354.663 323.11 398.2 338.78 498.56h57.94c-3.12-14.706-6.21-28.394-9.345-41.218-22.522-92.133-47.263-139.63-100.22-198.406 9.695-36.13 22.143-59.665 52.44-74.282 11.167 19.767 29.982 36.682 51.092 48.906l97.375 1.563.47-41.03L402 191.968c-8.05-5.556-14.925-11.73-20.75-18.314-14.886 9.08-32.024 12.563-48.156 7.313-18.422-5.997-31.143-21.962-37.063-41.282-3.482-11.37-4.742-24.05-3.686-37.25-25.017-4.884-50.047-7.746-75.063-7.72z',
  ufo: 'M256 27c-28.334 0-54.153 8.54-73.283 22.89C163.587 64.236 151 84.874 151 108c0 8.204 1.796 15.548 4.975 21.975 2.398 5.19 5.692 9.893 9.95 13.757a63.413 63.413 0 0 0 4.294 3.43c4.322 3.357 9.202 6.14 14.473 8.31 19.476 8.01 44.305 10 71.307 10 3.78 0 7.51-.045 11.197-.134 8.767-.154 17.47-.64 25.965-1.713 12.52-1.48 24.056-4.003 34.145-8.154a64.147 64.147 0 0 0 10.152-5.257 91.92 91.92 0 0 0 4.192-2.45c5.74-4.175 10.267-9.775 13.512-16.132 3.15-5.776 5.153-12.34 5.688-19.644.216-2.173.32-4.358.285-6.54a5.073 5.073 0 0 1-.196-.048c-.903-22.068-13.247-41.702-31.657-55.51C310.153 35.542 284.333 27 256 27zm0 18c24.686 0 46.868 7.578 62.482 19.29C334.097 76 343 91.36 343 108s-7.273 24.542-22.543 30.824c-15.27 6.283-38.44 8.65-64.457 8.65-26.017 0-49.187-2.367-64.457-8.65C176.273 132.542 169 124.64 169 108s8.903-32 24.518-43.71C209.132 52.577 231.314 45 256 45zm-37.775 17.748c-6.138.054-12.69 2.517-18.168 6.828-11.194 8.808-14.907 22.76-8.295 31.162 6.612 8.402 21.046 8.07 32.238-.738 11.193-8.81 14.906-22.76 8.293-31.162-3.115-3.957-8.16-6.142-14.068-6.09zm-85.29 47.78c-11.378 3.587-21.944 7.64-31.537 12.095C62.448 140.707 41 164.52 41 188c0 23.48 21.448 47.293 60.398 65.377C140.348 271.46 195.273 283 256 283c60.727 0 115.65-11.54 154.602-29.623C449.552 235.293 471 211.48 471 188c0-23.48-21.448-47.293-60.398-65.377-9.533-4.426-20.028-8.457-31.325-12.025-.997 20.097-10.243 39.685-27.293 51.935l-.222.16-.233.147c-33.465 21.076-73.328 21.37-108.768 20.252-29.29-.734-63.383-3.588-88.776-25.88l-.05-.046-.05-.045c-13.61-12.312-20.22-29.268-20.95-46.59zm290.116 47.23c7.672.046 15.3 2.61 20.97 8.28 6.98 6.978 9.254 16.924 7.92 26.265-1.335 9.34-6.04 18.522-13.577 26.06-7.538 7.538-16.72 12.242-26.06 13.576-9.34 1.334-19.287-.94-26.266-7.92-6.98-6.98-9.252-16.923-7.918-26.264 1.334-9.34 6.037-18.523 13.575-26.06 7.538-7.54 16.72-12.242 26.06-13.577a35.943 35.943 0 0 1 5.296-.362zm-336.042 1.94c1.77-.01 3.543.114 5.295.364 9.34 1.335 18.524 6.037 26.062 13.575 7.538 7.538 12.24 16.72 13.574 26.062 1.334 9.34-.94 19.284-7.92 26.263-6.978 6.98-16.92 9.25-26.262 7.916-9.34-1.336-18.525-6.037-26.063-13.575-7.538-7.538-12.24-16.722-13.574-26.063-1.333-9.34.94-19.284 7.92-26.263 5.67-5.672 13.297-8.235 20.968-8.28zm336.78 16.046a19.148 19.148 0 0 0-3.485.195c-4.99.712-10.922 3.523-15.88 8.482-4.96 4.958-7.77 10.89-8.484 15.88-.713 4.99.432 8.598 2.826 10.99 2.393 2.394 6 3.54 10.992 2.827 4.99-.714 10.918-3.527 15.877-8.485 4.958-4.96 7.77-10.887 8.484-15.877.712-4.99-.434-8.6-2.827-10.992-1.795-1.795-4.274-2.888-7.506-3.022zM86.27 177.686c-3.232.133-5.71 1.226-7.504 3.02-2.394 2.394-3.54 6-2.828 10.99.712 4.992 3.527 10.923 8.486 15.882 4.958 4.96 10.886 7.77 15.877 8.483 4.99.713 8.6-.432 10.993-2.826 2.393-2.393 3.54-6 2.826-10.99s-3.525-10.922-8.483-15.88c-4.96-4.96-10.89-7.77-15.88-8.483-1.25-.177-2.41-.24-3.487-.194zM256 211c10.66 0 20.48 3.17 28.027 8.83C291.577 225.492 297 234.13 297 244c0 9.87-5.424 18.508-12.973 24.17C276.48 273.83 266.66 277 256 277s-20.48-3.17-28.027-8.83C220.423 262.508 215 253.87 215 244c0-9.87 5.424-18.508 12.973-24.17C235.52 214.17 245.34 211 256 211zm0 18c-7.013 0-13.194 2.204-17.227 5.23-4.033 3.023-5.773 6.385-5.773 9.77s1.74 6.747 5.773 9.77c4.033 3.026 10.214 5.23 17.227 5.23s13.194-2.204 17.227-5.23c4.033-3.023 5.773-6.385 5.773-9.77s-1.74-6.747-5.773-9.77C269.194 231.203 263.013 229 256 229zm-55.1 68.898L112 480h288l-88.9-182.102C293.433 299.925 274.988 301 256 301s-37.433-1.075-55.1-3.102z',
  jetpack:
    'M316.78 22.875c-39.934 7.73-68.166 23.587-85.06 45.594l56.686 32.718c7.082-3.366 14.852-5.288 22.97-5.407 4.6-.066 9.312.447 14.062 1.595 3.55-21.452.93-46.382-8.657-74.5zm-97.155 60.188-86.97 150.562 93.126 53.813 21.876-37.875c-9.93-9.794-14.08-24.695-14.594-40.22-.63-18.986 3.98-40.098 12.563-59.187 6.37-14.167 14.91-27.294 25.72-37.22l-51.72-29.874zM426.095 86c-29.394 5.69-52.423 15.795-69.283 29.5 9.33 9.8 14.302 21.758 15.282 34.03l56.53 32.626c10.69-25.678 10.483-57.99-2.53-96.156zM64.968 94.063 27.03 159.78l102 42.75 60.814-105.31L64.97 94.062zm246.624 19.968c-6.535.105-12.59 2.26-18.563 5.845-11.942 7.17-22.876 21.332-30.342 37.938-7.467 16.605-11.48 35.512-10.97 50.906.51 15.377 5.323 26.064 12.813 30.405.008.004.026-.004.033 0 7.503 4.316 19.15 3.152 32.718-4.094 13.584-7.253 27.95-20.167 38.595-34.936 10.645-14.77 17.45-31.35 17.688-45.28.237-13.933-4.683-25.242-20.5-34.376-7.91-4.568-14.935-6.51-21.47-6.407zm58.812 56.126c-3.198 14.315-10.297 28.28-19.375 40.875-12.236 16.98-28.18 31.522-44.936 40.47-13.74 7.338-28.795 11.2-42.28 7.438l-21.845 37.812 93.124 53.78L422 199.94l-51.594-29.782zm54.22 62.625-60.782 105.345 88.03 67 37.938-65.75-65.187-106.594zm-276.657 31.282c-22.477 9.84-39.73 23.148-51.814 39.344l87.5 50.53c8.04-18.58 11.052-40.098 8.5-64.342l-44.187-25.53zM87.874 320.22 18.22 440.78v37.345l85.843-148.563-16.188-9.343zm169.406 6.967c-22.48 9.84-39.725 23.143-51.81 39.344l87.5 50.533c8.042-18.59 11.056-40.12 8.5-64.375l-44.19-25.5zm-135.09 12.844-90 154.876h21.62l84.594-145.5-16.22-9.375zm34.437 19.876-77.78 135h21.56l72.376-125.656-16.155-9.344zM197.47 383.5l-63.22 111.406h21.5l57.906-102.062-16.187-9.344zm34.436 19.906-51.062 91.5h21.375l45.874-82.187-16.188-9.314zm34.438 19.875-38.938 71.626h21.313l33.843-62.28-16.22-9.345z',
  chessKnight:
    'M60.81 476.91h300v-60h-300v60zm233.79-347.3 13.94 7.39c31.88-43.62 61.34-31.85 61.34-31.85l-21.62 53 35.64 19 2.87 33 64.42 108.75-43.55 29.37s-26.82-36.39-39.65-43.66c-10.66-6-41.22-10.25-56.17-12l-67.54-76.91-12 10.56 37.15 42.31c-.13.18-.25.37-.38.57-35.78 58.17 23 105.69 68.49 131.78H84.14C93 85 294.6 129.61 294.6 129.61z',
} as const;

function GameIcon({ icon, size = 40 }: { icon: keyof typeof GAME_ICON_PATHS; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={GAME_ICON_PATHS[icon]} />
    </svg>
  );
}

type ActiveGame = 'runner' | 'jumper' | null;
export type Difficulty = 'fast' | 'faster';

type LbEntry = { did: string; score: number };
type GameStats = { best: number; worst: number; tries: number };
const EMPTY_STATS: GameStats = { best: 0, worst: 0, tries: 0 };

function StatsDiffBlock({ label, stats }: { label: string; stats: GameStats }) {
  if (stats.tries === 0) return null;
  return (
    <>
      <div className={styles.lbDiffLabel}>{label}</div>
      <div className={`${styles.lbEntry} ${styles.lbEntryMe}`}>
        <span className={styles.lbHandle}>best</span>
        <span className={styles.lbScore}>{stats.best}</span>
      </div>
      <div className={styles.lbEntry}>
        <span className={styles.lbHandle}>worst</span>
        <span className={styles.lbScore}>{stats.worst}</span>
      </div>
      <div className={styles.lbEntry}>
        <span className={styles.lbHandle}>tries</span>
        <span className={styles.lbScore}>{stats.tries}</span>
      </div>
    </>
  );
}

function StatsCol({ stats }: { stats: { fast: GameStats; faster: GameStats } }) {
  const empty = stats.fast.tries === 0 && stats.faster.tries === 0;
  return (
    <div className={styles.lbCol}>
      <div className={styles.lbTitle}>you</div>
      <div className={styles.lbDivider} />
      {empty ? (
        <div className={styles.lbEmpty}>- - -</div>
      ) : (
        <>
          <StatsDiffBlock label="fast" stats={stats.fast} />
          {stats.fast.tries > 0 && stats.faster.tries > 0 && (
            <div className={styles.lbDiffDivider} />
          )}
          <StatsDiffBlock label="faster" stats={stats.faster} />
        </>
      )}
    </div>
  );
}

function LeaderboardCol({
  title,
  entries,
  viewerDid,
  handleMap,
}: {
  title: string;
  entries: LbEntry[];
  viewerDid?: string;
  handleMap: Record<string, string>;
}) {
  return (
    <div className={styles.lbCol}>
      <div className={styles.lbTitle}>{title}</div>
      <div className={styles.lbDivider} />
      {entries.length === 0 ? (
        <div className={styles.lbEmpty}>- - -</div>
      ) : (
        entries.slice(0, 5).map((e, i) => {
          const name = handleMap[e.did] ?? e.did.slice(-8);
          return (
            <div
              key={`${e.did}-${i}`}
              className={`${styles.lbEntry} ${e.did === viewerDid ? styles.lbEntryMe : ''}`}
            >
              <span className={styles.lbRank}>{i + 1}</span>
              <span className={styles.lbHandle}>{name}</span>
              <span className={styles.lbScore}>{e.score}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

const RUNNER_CREDITS = [
  { label: 'Icons', author: 'game-icons.net · CC BY 3.0', href: 'https://game-icons.net' },
];

const JUMPER_CREDITS = [
  { label: 'UFO', author: 'kenney.nl', href: 'https://kenney.nl' },
  {
    label: 'Spring',
    author: 'GlitchesDunArtist',
    href: 'https://opengameart.org/content/spring-0',
  },
  {
    label: 'Tiles',
    author: 'Emcee Flesher',
    href: 'https://opengameart.org/content/space-war-man-platform-shmup-set',
  },
  { label: 'Boing', author: 'Autumna', href: 'https://opengameart.org/content/boing' },
  {
    label: 'SFX',
    author: 'Vircon32 · CC-BY 4.0',
    href: 'https://opengameart.org/content/retro-game-sound-effects',
  },
];

function AttributionsCol({ items }: { items: typeof JUMPER_CREDITS }) {
  return (
    <div className={styles.lbCol}>
      <div className={styles.lbTitle}>credits</div>
      <div className={styles.lbDivider} />
      {items.map((item) => (
        <div key={item.href} className={styles.lbEntry}>
          <a href={item.href} target="_blank" rel="noopener noreferrer" className={styles.lbHandle}>
            {item.label}
          </a>
          <span className={styles.lbAttr}>{item.author}</span>
        </div>
      ))}
    </div>
  );
}

export function GamesPanel() {
  const { did, agent } = useAuth();
  const [activeGame, setActiveGame] = useState<ActiveGame>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('fast');
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

  if (activeGame === 'runner' && did && pds) {
    return (
      <div className={styles.panel}>
        <div className={styles.gameCol}>
          <div className={styles.gameWrap}>
            <RunnerGame
              did={did}
              pds={pds}
              difficulty={difficulty}
              onClose={reset}
              onScore={handleScore}
            />
          </div>
          <div className={styles.lbBelow}>
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
      <div className={styles.panel}>
        <div className={styles.gameRow}>
          <div className={styles.lbSide}>
            <AttributionsCol items={JUMPER_CREDITS} />
          </div>
          <div className={styles.gameWrap}>
            <JumperGame
              did={did}
              pds={pds}
              difficulty={difficulty}
              onClose={reset}
              onScore={handleScore}
            />
          </div>
          <div className={styles.lbSide}>
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

  const diffBtns = (game: NonNullable<ActiveGame>) => (
    <div className={styles.diffBtns}>
      <button
        className={styles.diffBtn}
        onClick={() => {
          launch(game, 'fast');
        }}
        type="button"
      >
        fast
      </button>
      <button
        className={styles.diffBtn}
        onClick={() => {
          launch(game, 'faster');
        }}
        type="button"
      >
        faster
      </button>
    </div>
  );

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Fun</h2>
      <div className={styles.grid}>
        <div className={styles.gameCard}>
          <span className={styles.gameIcon}>
            <GameIcon icon="run" size={40} />
          </span>
          <span className={styles.gameName}>runner</span>
          <span className={styles.gameDesc}>Dodge cacti · beat your high score</span>
          {diffBtns('runner')}
        </div>
        <div className={styles.gameCard}>
          <span className={styles.gameIcon}>
            <GameIcon icon="ufo" size={40} />
          </span>
          <span className={styles.gameName}>jumper</span>
          <span className={styles.gameDesc}>Jump up · don't fall · go higher</span>
          {diffBtns('jumper')}
        </div>
      </div>
    </div>
  );
}
