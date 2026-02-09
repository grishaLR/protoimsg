import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';

interface UseProfileEditorResult {
  displayName: string;
  setDisplayName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  avatarFile: File | null;
  setAvatarFile: (f: File | null) => void;
  avatarPreview: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  save: () => Promise<void>;
}

export function useProfileEditor(): UseProfileEditorResult {
  const { agent, did } = useAuth();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: profileData, isLoading: loading } = useQuery({
    queryKey: ['myProfile', did],
    queryFn: async () => {
      if (!agent || !did) throw new Error('No agent or DID');
      const res = await agent.app.bsky.actor.getProfile({ actor: did });
      return res.data;
    },
    enabled: !!agent && !!did,
  });

  // Populate form when profile loads
  useEffect(() => {
    if (profileData) {
      setDisplayName(profileData.displayName ?? '');
      setDescription(profileData.description ?? '');
      setAvatarPreview(profileData.avatar ?? null);
    }
  }, [profileData]);

  // Generate preview when avatar file changes
  useEffect(() => {
    if (avatarFile) {
      const url = URL.createObjectURL(avatarFile);
      setAvatarPreview(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [avatarFile]);

  const save = useCallback(async () => {
    if (!agent || !did) return;

    setSaving(true);
    setError(null);

    try {
      // Get existing record to preserve fields we're not editing
      let existingRecord: Record<string, unknown> = {};
      let swapCid: string | undefined;
      try {
        const existing = await agent.com.atproto.repo.getRecord({
          repo: did,
          collection: 'app.bsky.actor.profile',
          rkey: 'self',
        });
        existingRecord = existing.data.value as Record<string, unknown>;
        swapCid = existing.data.cid;
      } catch {
        // No existing profile record
      }

      // Upload avatar if changed
      let avatarBlob = existingRecord.avatar;
      if (avatarFile) {
        const res = await agent.uploadBlob(avatarFile, { encoding: avatarFile.type });
        avatarBlob = res.data.blob;
      }

      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: 'app.bsky.actor.profile',
        rkey: 'self',
        swapRecord: swapCid,
        record: {
          ...existingRecord,
          $type: 'app.bsky.actor.profile',
          displayName,
          description,
          avatar: avatarBlob,
        },
      });

      setAvatarFile(null);

      // Invalidate cached profile data
      void queryClient.invalidateQueries({ queryKey: ['myProfile', did] });
      void queryClient.invalidateQueries({ queryKey: ['profile', did] });
    } catch (err) {
      console.error('Failed to save profile:', err);
      setError('Failed to save profile');
    } finally {
      setSaving(false);
    }
  }, [agent, did, displayName, description, avatarFile, queryClient]);

  return {
    displayName,
    setDisplayName,
    description,
    setDescription,
    avatarFile,
    setAvatarFile,
    avatarPreview,
    loading,
    saving,
    error,
    save,
  };
}
