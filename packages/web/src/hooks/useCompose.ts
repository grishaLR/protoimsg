import { useState, useCallback, useMemo } from 'react';
import { RichText as RichTextAPI } from '@atproto/api';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useAuth } from './useAuth';
import { generateTid } from '../lib/atproto';

const MAX_GRAPHEMES = 300;
const MAX_IMAGES = 4;

/** Cached at module level — Intl.Segmenter is expensive to construct */
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

interface UseComposeResult {
  text: string;
  setText: (text: string) => void;
  images: File[];
  addImage: (file: File) => void;
  removeImage: (index: number) => void;
  replyTo: AppBskyFeedDefs.PostView | null;
  setReplyTo: (post: AppBskyFeedDefs.PostView | null) => void;
  posting: boolean;
  error: string | null;
  graphemeCount: number;
  canPost: boolean;
  submit: () => Promise<void>;
  clear: () => void;
}

function countGraphemes(text: string): number {
  let count = 0;
  for (const _ of graphemeSegmenter.segment(text)) {
    void _;
    count++;
  }
  return count;
}

export function useCompose(onSuccess?: () => void): UseComposeResult {
  const { agent } = useAuth();
  const [text, setText] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [replyTo, setReplyTo] = useState<AppBskyFeedDefs.PostView | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const graphemeCount = useMemo(() => countGraphemes(text), [text]);
  const canPost = graphemeCount > 0 && graphemeCount <= MAX_GRAPHEMES && !posting;

  const addImage = useCallback((file: File) => {
    setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, file]));
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => {
    setText('');
    setImages([]);
    setReplyTo(null);
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    if (!agent || !canPost) return;

    setPosting(true);
    setError(null);

    try {
      // Detect facets
      const rt = new RichTextAPI({ text });
      await rt.detectFacets(agent);

      // Upload images if any
      let embed: Record<string, unknown> | undefined;
      if (images.length > 0) {
        const blobRefs = await Promise.all(
          images.map(async (file) => {
            const res = await agent.uploadBlob(file, { encoding: file.type });
            return res.data.blob;
          }),
        );
        embed = {
          $type: 'app.bsky.embed.images',
          images: blobRefs.map((blob) => ({
            image: blob,
            alt: '',
          })),
        };
      }

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
          embed,
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
  }, [agent, canPost, text, images, replyTo, clear, onSuccess]);

  return {
    text,
    setText,
    images,
    addImage,
    removeImage,
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
