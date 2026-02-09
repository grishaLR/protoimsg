import { useCallback, useRef } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { RichText as RichTextAPI, type AppBskyFeedDefs } from '@atproto/api';
import { useAuth } from '../../hooks/useAuth';
import { FeedPost } from './FeedPost';
import { RichText, type GenericFacet } from '../chat/RichText';
import styles from './ProfileView.module.css';

const SCROLL_BOTTOM_THRESHOLD = 200;

interface ProfileViewProps {
  actor: string;
  onBack: () => void;
  onNavigateToProfile: (did: string) => void;
  onReply?: (post: AppBskyFeedDefs.PostView) => void;
  onOpenThread?: (post: AppBskyFeedDefs.PostView) => void;
}

export function ProfileView({
  actor,
  onBack,
  onNavigateToProfile,
  onReply,
  onOpenThread,
}: ProfileViewProps) {
  const { agent } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);

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
  const error = profileError ? 'Failed to load profile' : null;

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
      <button className={styles.backButton} onClick={onBack}>
        &larr; Back
      </button>

      {loading && <div className={styles.loading}>Loading profile...</div>}
      {error && <div className={styles.error}>{error}</div>}

      {profile && (
        <div className={styles.profileHeader}>
          {profile.banner ? (
            <img className={styles.banner} src={profile.banner} alt="" />
          ) : (
            <div className={styles.banner} />
          )}
          <div className={styles.profileInfo}>
            <div className={styles.avatarRow}>
              {profile.avatar ? (
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
                <RichText
                  text={profile.description}
                  facets={profile.detectedFacets}
                  onMentionClick={onNavigateToProfile}
                />
              </div>
            )}

            <div className={styles.stats}>
              <span>
                <span className={styles.statCount}>{profile.followersCount ?? 0}</span> followers
              </span>
              <span>
                <span className={styles.statCount}>{profile.followsCount ?? 0}</span> following
              </span>
              <span>
                <span className={styles.statCount}>{profile.postsCount ?? 0}</span> posts
              </span>
            </div>
          </div>
        </div>
      )}

      <div className={styles.scrollArea} ref={scrollRef} onScroll={onScroll}>
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
            />
          )}
          {posts.map((item) => (
            <FeedPost
              key={item.post.uri}
              item={item}
              onNavigateToProfile={onNavigateToProfile}
              onReply={onReply}
              onOpenThread={onOpenThread}
            />
          ))}

          {isFetchingNextPage && <div className={styles.loadingMore}>Loading more...</div>}
        </div>
      </div>
    </div>
  );
}
