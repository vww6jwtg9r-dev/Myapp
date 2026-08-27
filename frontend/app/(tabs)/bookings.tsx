import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { api } from '@/src/api';
import { Card, Badge, EmptyState } from '@/src/ui';
import { colors, spacing, font, radius } from '@/src/theme';

type Booking = {
  booking_id: string; vehicle_id: string; travel_date: string;
  seat_numbers: number[]; total_amount: number; status: 'pending' | 'paid' | 'cancelled';
  vehicle?: { model: string; from_location: string; to_location: string; departure_time: string; driver_name: string; vehicle_type: string; };
};

export default function Bookings() {
  const [items, setItems] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api<Booking[]>('/bookings/mine')); } catch (e) { console.log(e); } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.h1}>My Bookings</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {loading ? <ActivityIndicator color={colors.brandSecondary} /> :
          items.length === 0 ? <EmptyState title="No bookings yet" subtitle="Start exploring rides on Home." /> :
          items.map(b => (
            <Pressable
              key={b.booking_id}
              testID={`booking-${b.booking_id}`}
              onPress={() => router.push(b.status === 'paid' ? { pathname: '/ticket/[id]', params: { id: b.booking_id } } : { pathname: '/checkout/[id]', params: { id: b.booking_id } })}
            >
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Badge text={b.status.toUpperCase()} color={b.status === 'paid' ? colors.brandSecondary : b.status === 'pending' ? colors.warning : colors.error} />
                  <Text style={{ color: colors.muted, fontSize: font.sm }}>{b.travel_date}</Text>
                </View>
                <Text style={{ fontSize: font.lg, fontWeight: '800', color: colors.onSurface, marginTop: 8 }}>
                  {b.vehicle?.from_location} → {b.vehicle?.to_location}
                </Text>
                <Text style={{ color: colors.muted, marginTop: 2 }}>{b.vehicle?.model} · Dep {b.vehicle?.departure_time}</Text>
                <View style={styles.foot}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="grid" size={14} color={colors.brandPrimary} />
                    <Text style={{ color: colors.onSurfaceSecondary, fontWeight: '600' }}>Seats {b.seat_numbers.join(', ')}</Text>
                  </View>
                  <Text style={styles.amt}>₹{b.total_amount}</Text>
                </View>
                {b.status === 'paid' && (
                  <Pressable
                    testID={`rate-${b.booking_id}`}
                    onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/review/[id]', params: { id: b.booking_id } }); }}
                    style={styles.rateBtn}
                  >
                    <Ionicons name="star-outline" size={16} color={colors.brandPrimary} />
                    <Text style={{ color: colors.brandPrimary, fontWeight: '700' }}>Rate this trip</Text>
                  </Pressable>
                )}
              </Card>
            </Pressable>
          ))
        }
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  h1: { fontSize: 24, fontWeight: '800', color: colors.onSurface },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.divider },
  amt: { fontSize: 20, fontWeight: '800', color: colors.brandPrimary },
  rateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.brandTertiary },
});
