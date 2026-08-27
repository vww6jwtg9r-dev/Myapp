import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { api } from '@/src/api';
import { Card, Badge, EmptyState, Button } from '@/src/ui';
import { colors, spacing, font, radius } from '@/src/theme';

type Booking = {
  booking_id: string; vehicle_id: string; travel_date: string;
  seat_numbers: number[]; total_amount: number; status: 'pending' | 'paid' | 'cancelled';
  vehicle?: { model: string; from_location: string; to_location: string; departure_time: string; driver_name: string; vehicle_type: string; };
};

type Tab = 'upcoming' | 'completed' | 'cancelled';

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'upcoming', label: 'Upcoming', icon: 'time-outline' },
  { key: 'completed', label: 'Completed', icon: 'checkmark-circle-outline' },
  { key: 'cancelled', label: 'Cancelled', icon: 'close-circle-outline' },
];

function tripTimestamp(b: Booking): number {
  try {
    const [Y, M, D] = b.travel_date.split('-').map(Number);
    const [h, m] = ((b.vehicle?.departure_time) || '00:00').split(':').map(Number);
    return new Date(Y, (M || 1) - 1, D || 1, h || 0, m || 0).getTime();
  } catch { return 0; }
}

function classify(b: Booking): Tab {
  if (b.status === 'cancelled') return 'cancelled';
  const now = Date.now();
  return tripTimestamp(b) >= now ? 'upcoming' : 'completed';
}

export default function Bookings() {
  const [items, setItems] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api<Booking[]>('/bookings/mine')); } catch (e) { console.log(e); } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => items.filter(b => classify(b) === tab), [items, tab]);
  const counts = useMemo(() => ({
    upcoming: items.filter(b => classify(b) === 'upcoming').length,
    completed: items.filter(b => classify(b) === 'completed').length,
    cancelled: items.filter(b => classify(b) === 'cancelled').length,
  }), [items]);

  const doCancel = async () => {
    if (!confirmCancel) return;
    try {
      setCancelling(true);
      await api(`/bookings/${confirmCancel}/cancel`, { method: 'POST' });
      setConfirmCancel(null);
      load();
    } catch (e) { console.log(e); } finally { setCancelling(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.h1}>My Bookings</Text>
      </View>
      {/* Tab pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}
        style={{ flexGrow: 0 }}
      >
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              testID={`tab-${t.key}`}
              onPress={() => setTab(t.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Ionicons name={t.icon} size={14} color={active ? '#fff' : colors.onSurface} />
              <Text style={[styles.tabTxt, active && { color: '#fff' }]}>{t.label}</Text>
              {counts[t.key] > 0 && (
                <View style={[styles.tabCount, active && { backgroundColor: '#ffffff30' }]}>
                  <Text style={{ color: active ? '#fff' : colors.onSurface, fontSize: 11, fontWeight: '800' }}>{counts[t.key]}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {loading ? <ActivityIndicator color={colors.brandSecondary} /> :
          filtered.length === 0 ? (
            <EmptyState
              title={tab === 'upcoming' ? 'No upcoming rides' : tab === 'completed' ? 'No completed rides yet' : 'No cancelled rides'}
              subtitle={tab === 'upcoming' ? 'Book a ride from Home to see it here.' : ''}
            />
          ) : filtered.map(b => (
            <Pressable
              key={b.booking_id}
              testID={`booking-${b.booking_id}`}
              onPress={() => {
                if (b.status === 'paid') router.push({ pathname: '/ticket/[id]', params: { id: b.booking_id } });
                else if (b.status === 'pending') router.push({ pathname: '/checkout/[id]', params: { id: b.booking_id } });
              }}
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

                {tab === 'completed' && b.status === 'paid' && (
                  <Pressable
                    testID={`rate-${b.booking_id}`}
                    onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/review/[id]', params: { id: b.booking_id } }); }}
                    style={styles.altBtn}
                  >
                    <Ionicons name="star-outline" size={16} color={colors.brandPrimary} />
                    <Text style={{ color: colors.brandPrimary, fontWeight: '700' }}>Rate this trip</Text>
                  </Pressable>
                )}

                {tab === 'upcoming' && (
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                    {b.status === 'pending' && (
                      <Pressable testID={`pay-now-${b.booking_id}`} onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/checkout/[id]', params: { id: b.booking_id } }); }} style={[styles.altBtn, { flex: 1, backgroundColor: colors.brandSecondary }]}>
                        <Ionicons name="card-outline" size={16} color="#fff" />
                        <Text style={{ color: '#fff', fontWeight: '700' }}>Pay Now</Text>
                      </Pressable>
                    )}
                    <Pressable
                      testID={`cancel-${b.booking_id}`}
                      onPress={(e) => { e.stopPropagation?.(); setConfirmCancel(b.booking_id); }}
                      style={[styles.altBtn, { flex: 1, backgroundColor: '#fee' }]}
                    >
                      <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                      <Text style={{ color: colors.error, fontWeight: '700' }}>Cancel</Text>
                    </Pressable>
                  </View>
                )}
              </Card>
            </Pressable>
          ))
        }
      </ScrollView>

      <Modal visible={!!confirmCancel} transparent animationType="fade" onRequestClose={() => setConfirmCancel(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <Ionicons name="alert-circle" size={40} color={colors.error} style={{ alignSelf: 'center' }} />
            <Text style={{ fontSize: font.xl, fontWeight: '800', textAlign: 'center', marginTop: 8, color: colors.onSurface }}>Cancel booking?</Text>
            <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 4 }}>Your seats will be released.</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <Button title="Keep" variant="outline" onPress={() => setConfirmCancel(null)} style={{ flex: 1 }} />
              <Button testID="confirm-cancel" title="Cancel Booking" onPress={doCancel} loading={cancelling} style={{ flex: 1, backgroundColor: colors.error }} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  h1: { fontSize: 24, fontWeight: '800', color: colors.onSurface },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.divider },
  amt: { fontSize: 20, fontWeight: '800', color: colors.brandPrimary },
  altBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.brandTertiary },
  tab: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabTxt: { fontWeight: '700', color: colors.onSurface, fontSize: font.sm },
  tabCount: { backgroundColor: colors.surfaceSecondary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, minWidth: 20, alignItems: 'center' },
  modalBg: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000080', padding: spacing.xl },
  modal: { backgroundColor: '#fff', borderRadius: 20, padding: spacing.xl, width: '100%', maxWidth: 340 },
});
