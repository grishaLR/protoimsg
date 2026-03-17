import { useState, useCallback, useMemo } from 'react';
import { RichText as RichTextAPI } from '@atproto/api';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useAuth } from '@/services/auth';
import { generateTid } from '@/services/atproto';

const MAX_GRAPHEMES = 300;

function countGraphemes(text: string): number {
  // Intl.Segmenter may not be available in Hermes — fall back to Array.from
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let count = 0;
    for (const _ of segmenter.segment(text)) {
      void _;
      count++;
    }
    return count;
  }
  return Array.from(text).length;
}

interface UseComposeResult {
  text: string;
  setText: (text: string) => void;
  replyTo: AppBskyFeedDefs.PostView | null;
  setReplyTo: (post: AppBskyFeedDefs.PostView | null) => void;
  posting: boolean;
  error: string | null;
  graphemeCount: number;
  canPost: boolean;
  submit: () => Promise<void>;
  clear: () => void;
}

export function useCompose(onSuccess?: () => void): UseComposeResult {
  const { agent } = useAuth();
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<AppBskyFeedDefs.PostView | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const graphemeCount = useMemo(() => countGraphemes(text), [text]);
  const canPost = graphemeCount > 0 && graphemeCount <= MAX_GRAPHEMES && !posting;

  const clear = useCallback(() => {
    setText('');
    setReplyTo(null);
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    if (!agent || !canPost) return;

    setPosting(true);
    setError(null);

    try {
      // Detect facets (mentions, links, tags)
      const rt = new RichTextAPI({ text });
      await rt.detectFacets(agent);

      // Build reply ref
      let replyRef: Record<string, unknown> | undefined;
      if (replyTo) {
        const replyRecord = replyTo.record as Record<string, unknown>;
        const existingReply = replyRecord.reply as
          | { root: { uri: string; cid: string } }
          | undefined;

        const root = existingReply ? existingReply.root : { uri: replyTo.uri, cid: replyTo.cid };
        const parent = { uri: replyTo.uri, cid: replyTo.cid };
        replyRef = { root, parent };
      }

      const rkey = generateTid();
      await agent.com.atproto.repo.createRecord({
        repo: agent.assertDid,
        collection: 'app.bsky.feed.post',
        rkey,
        record: {
          $type: 'app.bsky.feed.post',
          text: rt.text,
          facets: rt.facets,
          reply: replyRef,
          createdAt: new Date().toISOString(),
        },
      });

      clear();
      onSuccess?.();
    } catch (err) {
      console.error('Failed to post:', err);
      setError('Failed to post');
    } finally {
      setPosting(false);
    }
  }, [agent, canPost, text, replyTo, clear, onSuccess]);

  return {
    text,
    setText,
    replyTo,
    setReplyTo,
    posting,
    error,
    graphemeCount,
    canPost,
    submit,
    clear,
  };
}
