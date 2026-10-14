import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';

import { useSession } from '@/features/auth/auth';
import type { ProfileRow, ProfileUpdate } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export const profileKey = (uid: string | undefined) => ['profile', uid] as const;

export async function fetchProfile(uid: string): Promise<ProfileRow> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).single();
  if (error) throw error;
  return data;
}

export function useProfile() {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({
    queryKey: profileKey(uid),
    queryFn: () => fetchProfile(uid!),
    enabled: !!uid,
    staleTime: 60_000,
  });
}

export async function updateProfile(uid: string, patch: ProfileUpdate): Promise<ProfileRow> {
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', uid).select('*').single();
  if (error) throw error;
  return data;
}

export function useUpdateProfile() {
  const uid = useSession((s) => s.session?.user.id);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfileUpdate) => updateProfile(uid!, patch),
    onSuccess: (row) => qc.setQueryData(profileKey(uid), row),
  });
}

// ---------- Avatar ----------

export function useAvatarUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['avatar-url', path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path!, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export type PickResult = 'ok' | 'cancelled' | 'denied';

/** Let the person pick a square photo and make it their avatar. */
export function useChangeAvatar() {
  const uid = useSession((s) => s.session?.user.id);
  const update = useUpdateProfile();
  return useMutation({
    mutationFn: async (oldPath: string | null): Promise<PickResult> => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return 'denied';
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (picked.canceled || !picked.assets[0]) return 'cancelled';
      const asset = picked.assets[0];
      const contentType = asset.mimeType ?? 'image/jpeg';
      const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
      // New file name each time so cached signed URLs never show the old picture.
      const path = `${uid}/avatar-${Date.now()}.${ext}`;
      const body = await (await fetch(asset.uri)).arrayBuffer();
      const { error } = await supabase.storage.from('avatars').upload(path, body, { contentType, upsert: false });
      if (error) throw error;
      await update.mutateAsync({ avatar_path: path });
      if (oldPath) await supabase.storage.from('avatars').remove([oldPath]);
      return 'ok';
    },
  });
}

export function useRemoveAvatar() {
  const update = useUpdateProfile();
  return useMutation({
    mutationFn: async (oldPath: string) => {
      await update.mutateAsync({ avatar_path: null });
      await supabase.storage.from('avatars').remove([oldPath]);
    },
  });
}
