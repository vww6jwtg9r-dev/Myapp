import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Pressable, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/src/auth';
import { Button } from '@/src/ui';
import { colors, radius, spacing, font } from '@/src/theme';
import { fileUrl, uploadImage } from '@/src/api';

export default function Onboarding() {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [emergency, setEmergency] = useState(user?.emergency_contact || '');
  const [picture, setPicture] = useState<string | null>(user?.picture || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = async () => {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setErr('Permission denied'); return; }
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    if (res.canceled) return;
    try {
      setBusy(true);
      const up = await uploadImage(res.assets[0].uri);
      setPicture(up.url);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!name.trim()) { setErr('Name required'); return; }
    try {
      setBusy(true); setErr(null);
      await updateProfile({ name: name.trim(), picture: picture || undefined, emergency_contact: emergency.trim() || undefined });
      router.replace('/(tabs)');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const src = picture ? fileUrl(picture) : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl }}>
        <Text style={styles.h1}>Complete your profile</Text>
        <Text style={styles.sub}>Tell us a bit about you so drivers can recognize you.</Text>

        <View style={{ alignItems: 'center', marginVertical: spacing.xl }}>
          <Pressable testID="onboarding-avatar-picker" onPress={pick} style={styles.avatar}>
            {src ? <Image source={{ uri: src }} style={styles.avatar} /> :
              <Ionicons name="person" size={48} color={colors.muted} />}
            <View style={styles.avatarBadge}><Ionicons name="camera" size={16} color="#fff" /></View>
          </Pressable>
        </View>

        <Text style={styles.label}>Full Name</Text>
        <TextInput testID="onboarding-name-input" value={name} onChangeText={setName} placeholder="Your name" style={styles.input} placeholderTextColor={colors.muted} />

        <Text style={styles.label}>Emergency Contact (optional)</Text>
        <TextInput testID="onboarding-emergency-input" value={emergency} onChangeText={setEmergency} placeholder="+91 90000 00000" keyboardType="phone-pad" style={styles.input} placeholderTextColor={colors.muted} />

        {err && <Text style={{ color: colors.error, marginTop: spacing.sm }}>{err}</Text>}

        <View style={{ marginTop: spacing.xl }}>
          <Button testID="onboarding-save-button" title="Save & Continue" onPress={save} loading={busy} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: font.xxl, fontWeight: '800', color: colors.onSurface },
  sub: { color: colors.muted, marginTop: 6 },
  avatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.border },
  avatarBadge: { position: 'absolute', right: 0, bottom: 0, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff' },
  label: { color: colors.onSurfaceSecondary, marginTop: spacing.md, marginBottom: 6, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 14, fontSize: font.lg, color: colors.onSurface },
});
