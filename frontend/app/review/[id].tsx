import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { api } from '@/src/api';
import { Card, Button } from '@/src/ui';
import { colors, spacing, font, radius } from '@/src/theme';

export default function Review() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [booking, setBooking] = useState<any>(null);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try { setBooking(await api(`/bookings/${id}`)); } catch (e: any) { setErr(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    try {
      setBusy(true); setErr(null);
      await api('/reviews', { method: 'POST', body: JSON.stringify({ booking_id: id, stars, comment: comment.trim() || undefined }) });
      setDone(true);
      setTimeout(() => router.replace('/(tabs)/bookings'), 1200);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (!booking) return <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brandSecondary} /></SafeAreaView>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.h1}>Rate Trip</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <Card>
          <Text style={{ fontWeight: '800', color: colors.onSurface, fontSize: font.lg }}>{booking.vehicle?.model}</Text>
          <Text style={{ color: colors.muted, marginTop: 4 }}>{booking.vehicle?.driver_name} · {booking.vehicle?.from_location} → {booking.vehicle?.to_location}</Text>
        </Card>

        <Card>
          <Text style={styles.section}>How was your ride?</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginVertical: spacing.md }}>
            {[1, 2, 3, 4, 5].map(n => (
              <Pressable key={n} testID={`star-${n}`} onPress={() => setStars(n)}>
                <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={40} color={colors.warning} />
              </Pressable>
            ))}
          </View>
          <Text style={{ textAlign: 'center', color: colors.muted, fontSize: font.sm }}>
            {['Terrible', 'Poor', 'Okay', 'Good', 'Excellent'][stars - 1]}
          </Text>

          <Text style={[styles.section, { marginTop: spacing.lg }]}>Leave a comment (optional)</Text>
          <TextInput
            testID="review-comment"
            value={comment}
            onChangeText={setComment}
            placeholder="Share your experience with future riders..."
            placeholderTextColor={colors.muted}
            multiline
            numberOfLines={4}
            style={styles.input}
          />
        </Card>

        {err && <Text style={{ color: colors.error }}>{err}</Text>}
        {done && <Text style={{ color: colors.brandSecondary, fontWeight: '700' }}>Thanks for your review! 🎉</Text>}

        <Button testID="review-submit" title="Submit Review" onPress={submit} loading={busy} disabled={done} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  h1: { fontSize: font.xl, fontWeight: '800', color: colors.onSurface },
  iconBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, minHeight: 100, textAlignVertical: 'top', fontSize: font.base, color: colors.onSurface, marginTop: spacing.sm },
});
