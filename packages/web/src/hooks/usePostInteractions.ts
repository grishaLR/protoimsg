import { useState, useCallback, useEffect } from 'react';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useAuth } from './useAuth';
import { generateTid, extractRkey } from '../lib/atproto';

interface PostInteractions {
  isLiked: boolean;
  isReposted: boolean;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  toggleLike: () => void;
  toggleRepost: () => void;
}

export function usePostInteractions(post: AppBskyFeedDefs.PostView): PostInteractions {
  const { agent } = useAuth();

  const [likeUri, setLikeUri] = useState<string | undefined>(post.viewer?.like);
  const [repostUri, setRepostUri] = useState<string | undefined>(post.viewer?.repost);
  const [likeCount, setLikeCount] = useState(post.likeCount ?? 0);
  const [repostCount, setRepostCount] = useState(post.repostCount ?? 0);

  // Reset state when post changes (e.g. carousel, feed refresh)
  useEffect(() => {
    setLikeUri(post.viewer?.like);
    setRepostUri(post.viewer?.repost);
    setLikeCount(post.likeCount ?? 0);
    setRepostCount(post.repostCount ?? 0);
  }, [post.uri]);

  const toggleLike = useCallback(() => {
    if (!agent) return;

    if (likeUri) {
      // Unlike — optimistic
      const prevUri = likeUri;
      const prevCount = likeCount;
      setLikeUri(undefined);
      setLikeCount((c) => Math.max(0, c - 1));

      void agent.com.atproto.repo
        .deleteRecord({
          repo: agent.assertDid,
          collection: 'app.bsky.feed.like',
          rkey: extractRkey(prevUri),
        })
        .catch(() => {
          setLikeUri(prevUri);
          setLikeCount(prevCount);
        });
    } else {
      // Like — optimistic
      const prevCount = likeCount;
      setLikeCount((c) => c + 1);
      setLikeUri('pending');

      const rkey = generateTid();
      void agent.com.atproto.repo
        .createRecord({
          repo: agent.assertDid,
          collection: 'app.bsky.feed.like',
          rkey,
          record: {
            $type: 'app.bsky.feed.like',
            subject: { uri: post.uri, cid: post.cid },
            createdAt: new Date().toISOString(),
          },
        })
        .then((res) => {
          setLikeUri(res.data.uri);
        })
        .catch(() => {
          setLikeUri(undefined);
          setLikeCount(prevCount);
        });
    }
  }, [agent, likeUri, likeCount, post.uri, post.cid]);

  const toggleRepost = useCallback(() => {
    if (!agent) return;

    if (repostUri) {
      const prevUri = repostUri;
      const prevCount = repostCount;
      setRepostUri(undefined);
      setRepostCount((c) => Math.max(0, c - 1));

      void agent.com.atproto.repo
        .deleteRecord({
          repo: agent.assertDid,
          collection: 'app.bsky.feed.repost',
          rkey: extractRkey(prevUri),
        })
        .catch(() => {
          setRepostUri(prevUri);
          setRepostCount(prevCount);
        });
    } else {
      const prevCount = repostCount;
      setRepostCount((c) => c + 1);
      setRepostUri('pending');

      const rkey = generateTid();
      void agent.com.atproto.repo
        .createRecord({
          repo: agent.assertDid,
          collection: 'app.bsky.feed.repost',
          rkey,
          record: {
            $type: 'app.bsky.feed.repost',
            subject: { uri: post.uri, cid: post.cid },
            createdAt: new Date().toISOString(),
          },
        })
        .then((res) => {
          setRepostUri(res.data.uri);
        })
        .catch(() => {
          setRepostUri(undefined);
          setRepostCount(prevCount);
        });
    }
  }, [agent, repostUri, repostCount, post.uri, post.cid]);

  return {
    isLiked: !!likeUri,
    isReposted: !!repostUri,
    likeCount,
    repostCount,
    replyCount: post.replyCount ?? 0,
    toggleLike,
    toggleRepost,
  };
}
