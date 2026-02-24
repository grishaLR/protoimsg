import { useCallback, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { RichText as RichTextAPI, type AppBskyFeedDefs } from '@atproto/api';
import { useAuth } from '../../hooks/useAuth';
import { useGermDeclaration } from '../../hooks/useGermDeclaration';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { isSafeUrl } from '../../lib/sanitize';
import { FeedPost } from './FeedPost';
import { RichText, type GenericFacet } from '../chat/RichText';
import styles from './ProfileView.module.css';

/** Hook: observe when an element leaves the scroll viewport */
function useHeaderPinned(scrollRef: React.RefObject<HTMLDivElement | null>) {
  const [pinned, setPinned] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Callback ref — fires when the sentinel DOM node mounts/unmounts
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }

      const root = scrollRef.current;
      if (!node || !root) {
        setPinned(false);
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry) setPinned(!entry.isIntersecting);
        },
        { root, threshold: 0.5 },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [scrollRef],
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  return { sentinelRef, pinned };
}

const SCROLL_BOTTOM_THRESHOLD = 200;

/** Module-level cache: profile DID → scrollTop. Survives unmount/remount. */
const profileScrollCache = new Map<string, number>();

interface ProfileViewProps {
  actor: string;
  onBack: () => void;
  onNavigateToProfile: (did: string) => void;
  onReply?: (post: AppBskyFeedDefs.PostView) => void;
  onOpenThread?: (post: AppBskyFeedDefs.PostView) => void;
  onQuotePost?: (post: AppBskyFeedDefs.PostView) => void;
}

export function ProfileView({
  actor,
  onBack,
  onNavigateToProfile,
  onReply,
  onOpenThread,
  onQuotePost,
}: ProfileViewProps) {
  const { t } = useTranslation('feed');
  const { agent } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    autoTranslate,
    available: translateAvailable,
    targetLang,
    getTranslation,
    isTranslating: isTranslatingText,
    requestTranslation,
    requestBatchTranslation,
  } = useContentTranslation();
  const [showTranslatedBio, setShowTranslatedBio] = useState(autoTranslate);
  const lastTranslatedCount = useRef(0);

  const {
    data: profileData,
    isLoading: profileLoading,
    error: profileError,
  } = useQuery({
    queryKey: ['profile', actor],
    queryFn: async () => {
      if (!agent) throw new Error('No agent');
      const res = await agent.app.bsky.actor.getProfile({ actor });
      const data = res.data;

      // Detect facets (links, mentions, tags) in the description
      let descFacets: GenericFacet[] | undefined;
      if (data.description) {
        const rt = new RichTextAPI({ text: data.description });
        await rt.detectFacets(agent);
        if (rt.facets && rt.facets.length > 0) {
          descFacets = rt.facets as unknown as GenericFacet[];
        }
      }

      return { ...data, detectedFacets: descFacets };
    },
    enabled: !!agent,
  });
  const profile = profileData ?? null;
  const { canMessage: germAvailable, germUrl } = useGermDeclaration(profile?.did);
  const pinnedPostUri = (profile as Record<string, unknown> | null)?.pinnedPost
    ? ((profile as Record<string, unknown>).pinnedPost as { uri: string }).uri
    : null;

  // Fetch the pinned post separately
  const { data: pinnedPostData } = useQuery({
    queryKey: ['pinnedPost', pinnedPostUri],
    queryFn: async () => {
      if (!agent || !pinnedPostUri) throw new Error('No agent or URI');
      const res = await agent.app.bsky.feed.getPosts({ uris: [pinnedPostUri] });
      return res.data.posts[0] ?? null;
    },
    enabled: !!agent && !!pinnedPostUri,
  });

  const {
    data: feedData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: feedLoading,
  } = useInfiniteQuery({
    queryKey: ['authorFeed', actor],
    queryFn: async ({ pageParam }) => {
      if (!agent) throw new Error('No agent');
      const res = await agent.app.bsky.feed.getAuthorFeed({
        actor,
        filter: 'posts_no_replies',
        limit: 30,
        cursor: pageParam,
      });
      return res.data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor,
    enabled: !!agent,
  });

  const allPosts = feedData?.pages.flatMap((p) => p.feed) ?? [];
  // Deduplicate pinned post from the regular feed
  const posts = pinnedPostUri
    ? allPosts.filter((item) => item.post.uri !== pinnedPostUri)
    : allPosts;
  const loading = profileLoading || feedLoading;
  const error = profileError ? t('profileView.error') : null;

  const { sentinelRef, pinned } = useHeaderPinned(scrollRef);

  // Restore scroll position when profile loads
  useEffect(() => {
    if (!profile || !scrollRef.current) return;
    const saved = profileScrollCache.get(actor);
    if (saved) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = saved;
        }
      });
    }
  }, [actor, profile]);

  // Save scroll position on unmount
  useEffect(() => {
    const currentActor = actor;
    const ref = scrollRef;
    return () => {
      if (ref.current) {
        profileScrollCache.set(currentActor, ref.current.scrollTop);
      }
    };
  }, [actor]);

  // Auto-translate bio on load
  const bioText = profile?.description ?? '';
  const translatedBio = bioText ? getTranslation(bioText) : undefined;
  const bioTranslating = bioText ? isTranslatingText(bioText) : false;

  useEffect(() => {
    if (autoTranslate && translateAvailable && bioText) {
      requestTranslation(bioText);
    }
  }, [autoTranslate, translateAvailable, bioText, requestTranslation]);

  // Auto-translate posts as pages load
  useEffect(() => {
    if (!autoTranslate || !translateAvailable || allPosts.length === 0) return;
    if (allPosts.length === lastTranslatedCount.current) return;

    const newPosts = allPosts.slice(lastTranslatedCount.current);
    const texts = newPosts
      .map((item) => ((item.post.record as Record<string, unknown>).text as string) || '')
      .filter(Boolean);

    lastTranslatedCount.current = allPosts.length;
    if (texts.length > 0) requestBatchTranslation(texts);
  }, [allPosts.length, autoTranslate, translateAvailable, allPosts, requestBatchTranslation]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (
      hasNextPage &&
      !isFetchingNextPage &&
      el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
    ) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className={styles.profileView}>
      {/* Sticky compact bar — appears when full header scrolls out */}
      {profile && (
        <div
          className={`${styles.stickyBar} ${pinned ? styles.stickyBarVisible : ''}`}
          style={
            profile.banner && isSafeUrl(profile.banner)
              ? { backgroundImage: `url(${profile.banner})` }
              : undefined
          }
        >
          <div className={styles.stickyOverlay} />
          <button className={styles.stickyBackButton} onClick={onBack} type="button">
            <ArrowLeft size={14} />
          </button>
          {profile.avatar && isSafeUrl(profile.avatar) ? (
            <img
              className={styles.stickyAvatar}
              // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() above
              src={profile.avatar}
              alt=""
            />
          ) : (
            <div className={styles.stickyAvatar} />
          )}
          <span className={styles.stickyName}>{profile.displayName || profile.handle}</span>
        </div>
      )}

      <div className={styles.scrollArea} ref={scrollRef} onScroll={onScroll}>
        <button className={styles.backButton} onClick={onBack} type="button">
          <ArrowLeft size={14} /> {t('profileView.back')}
        </button>

        {loading && <div className={styles.loading}>{t('profileView.loading')}</div>}
        {error && <div className={styles.error}>{error}</div>}

        {profile && (
          <div className={styles.profileHeader} ref={sentinelRef}>
            {profile.banner && isSafeUrl(profile.banner) ? (
              // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() above
              <img className={styles.banner} src={profile.banner} alt="" />
            ) : (
              <div className={styles.banner} />
            )}
            <div className={styles.profileInfo}>
              <div className={styles.avatarRow}>
                {profile.avatar && isSafeUrl(profile.avatar) ? (
                  // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() above
                  <img className={styles.profileAvatar} src={profile.avatar} alt="" />
                ) : (
                  <div className={styles.profileAvatar} />
                )}
                <div className={styles.names}>
                  <div className={styles.profileDisplayName}>
                    {profile.displayName || profile.handle}
                  </div>
                  <div className={styles.profileHandle}>@{profile.handle}</div>
                </div>
              </div>

              {profile.description && (
                <div className={styles.bio}>
                  {showTranslatedBio && translatedBio ? (
                    <>
                      {translatedBio}
                      <div className={styles.translationLabel}>
                        {t('profileView.translatedTo', { lang: targetLang })}
                        {' \u00B7 '}
                        <button
                          type="button"
                          className={styles.showOriginal}
                          onClick={() => {
                            setShowTranslatedBio(false);
                          }}
                        >
                          {t('profileView.showOriginal')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <RichText
                        text={profile.description}
                        facets={profile.detectedFacets}
                        onMentionClick={onNavigateToProfile}
                      />
                      {translateAvailable && (
                        <button
                          type="button"
                          className={styles.translateBioButton}
                          onClick={() => {
                            if (translatedBio) {
                              setShowTranslatedBio(true);
                            } else {
                              requestTranslation(profile.description ?? '');
                              setShowTranslatedBio(true);
                            }
                          }}
                          disabled={bioTranslating}
                        >
                          {bioTranslating
                            ? t('profileView.translating')
                            : t('profileView.translateBio')}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className={styles.stats}>
                <span>
                  <span className={styles.statCount}>{profile.followersCount ?? 0}</span>{' '}
                  {t('profileView.followers')}
                </span>
                <span>
                  <span className={styles.statCount}>{profile.followsCount ?? 0}</span>{' '}
                  {t('profileView.following')}
                </span>
                <span>
                  <span className={styles.statCount}>{profile.postsCount ?? 0}</span>{' '}
                  {t('profileView.posts')}
                </span>
              </div>

              {germAvailable && germUrl && (
                <div className={styles.profileActions}>
                  <a
                    className={styles.germButton}
                    // eslint-disable-next-line no-restricted-syntax -- germUrl validated by isSafeUrl() in useGermDeclaration
                    href={germUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      className={styles.germLogo}
                      src="/images/germ_logo.webp"
                      alt=""
                      width={16}
                      height={16}
                    />
                    {t('profileView.germDm')}
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        <div className={styles.postsSection}>
          {pinnedPostData && (
            <FeedPost
              key={`pinned-${pinnedPostData.uri}`}
              item={{
                post: pinnedPostData,
                $type: 'app.bsky.feed.defs#feedViewPost',
                reason: { $type: 'app.bsky.feed.defs#reasonPin' },
              }}
              onNavigateToProfile={onNavigateToProfile}
              onReply={onReply}
              onOpenThread={onOpenThread}
              onQuotePost={onQuotePost}
            />
          )}
          {posts.map((item) => (
            <FeedPost
              key={item.post.uri}
              item={item}
              onNavigateToProfile={onNavigateToProfile}
              onReply={onReply}
              onOpenThread={onOpenThread}
              onQuotePost={onQuotePost}
            />
          ))}

          {isFetchingNextPage && (
            <div className={styles.loadingMore}>{t('profileView.loadingMore')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
