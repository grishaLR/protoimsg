import { useState, useCallback, useMemo } from 'react';
import { RichText as RichTextAPI } from '@atproto/api';
import type { AppBskyFeedDefs } from '@atproto/api';
import type { GifResult } from '../lib/api';
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
  imageAlts: string[];
  addImage: (file: File) => void;
  removeImage: (index: number) => void;
  setImageAlt: (index: number, alt: string) => void;
  gif: GifResult | null;
  setGif: (gif: GifResult | null) => void;
  gifAlt: string;
  setGifAlt: (alt: string) => void;
  replyTo: AppBskyFeedDefs.PostView | null;
  setReplyTo: (post: AppBskyFeedDefs.PostView | null) => void;
  quoteTo: AppBskyFeedDefs.PostView | null;
  setQuoteTo: (post: AppBskyFeedDefs.PostView | null) => void;
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
  const [imageAlts, setImageAlts] = useState<string[]>([]);
  const [gif, setGif] = useState<GifResult | null>(null);
  const [gifAlt, setGifAlt] = useState('');
  const [replyTo, setReplyTo] = useState<AppBskyFeedDefs.PostView | null>(null);
  const [quoteTo, setQuoteTo] = useState<AppBskyFeedDefs.PostView | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const graphemeCount = useMemo(() => countGraphemes(text), [text]);
  const hasContent = graphemeCount > 0 || images.length > 0 || gif !== null || quoteTo !== null;
  const canPost = hasContent && graphemeCount <= MAX_GRAPHEMES && !posting;

  const addImage = useCallback((file: File) => {
    setImages((prev) => {
      if (prev.length >= MAX_IMAGES) return prev;
      setImageAlts((alts) => [...alts, '']);
      return [...prev, file];
    });
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setImageAlts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const setImageAlt = useCallback((index: number, alt: string) => {
    setImageAlts((prev) => {
      const next = [...prev];
      next[index] = alt;
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setText('');
    setImages([]);
    setImageAlts([]);
    setGif(null);
    setGifAlt('');
    setReplyTo(null);
    setQuoteTo(null);
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

      // Build embed: GIF (external) or images
      let embed: Record<string, unknown> | undefined;
      if (gif) {
        // Fetch GIF as blob and upload as thumbnail for Bluesky-compatible link card
        let thumbBlob: unknown;
        try {
          const gifRes = await fetch(gif.previewUrl);
          const gifData = await gifRes.blob();
          const uploaded = await agent.uploadBlob(gifData, { encoding: 'image/gif' });
          thumbBlob = uploaded.data.blob;
        } catch {
          // If thumbnail upload fails, post without it
        }

        const description = gifAlt || `via ${gif.source === 'klipy' ? 'Klipy' : 'GIPHY'}`;

        embed = {
          $type: 'app.bsky.embed.external',
          external: {
            uri: gif.fullUrl,
            title: gif.title || 'GIF',
            description,
            ...(thumbBlob ? { thumb: thumbBlob } : {}),
          },
        };
      } else if (images.length > 0) {
        const blobRefs = await Promise.all(
          images.map(async (file) => {
            const res = await agent.uploadBlob(file, { encoding: file.type });
            return res.data.blob;
          }),
        );
        embed = {
          $type: 'app.bsky.embed.images',
          images: blobRefs.map((blob, i) => ({
            image: blob,
            alt: imageAlts[i] || '',
          })),
        };
      }

      // Wrap embed in quote record if quoting a post
      if (quoteTo) {
        const quoteRef = {
          $type: 'com.atproto.repo.strongRef',
          uri: quoteTo.uri,
          cid: quoteTo.cid,
        };
        if (embed) {
          // Has media + quote → recordWithMedia
          embed = {
            $type: 'app.bsky.embed.recordWithMedia',
            record: { $type: 'app.bsky.embed.record', record: quoteRef },
            media: embed,
          };
        } else {
          // Quote only, no media
          embed = {
            $type: 'app.bsky.embed.record',
            record: quoteRef,
          };
        }
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
  }, [agent, canPost, text, images, imageAlts, gif, gifAlt, replyTo, quoteTo, clear, onSuccess]);

  return {
    text,
    setText,
    images,
    imageAlts,
    addImage,
    removeImage,
    setImageAlt,
    gif,
    setGif,
    gifAlt,
    setGifAlt,
    replyTo,
    setReplyTo,
    quoteTo,
    setQuoteTo,
    posting,
    error,
    graphemeCount,
    canPost,
    submit,
    clear,
  };
}
