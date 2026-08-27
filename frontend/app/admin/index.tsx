import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api } from '@/src/api';
import { Card, Button, Badge } from '@/src/ui';
import { colors, spacing, font } from '@/src/theme';

type Stats = { total_revenue: number; platform_commission: number; active_drivers: number; total_bookings: number; pending_approvals: number };
type Vehicle = { vehicle_id: string; model: string; number_plate: string; driver_name: string; status: string; vehicle_type: string; from_location: string; to_location: string; fare_per_seat: number; total_seats: number };

export default function Admin() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [pending, setPending] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api<Stats>('/admin/stats'), api<Vehicle[]>('/admin/vehicles/pending')]);
      setStats(s); setPending(p);
    } catch (e) { console.log(e); } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: 'approve' | 'reject') => {
    try { await api(`/admin/vehicles/${id}/${action}`, { method: 'POST' }); load(); } catch (e) { console.log(e); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.h1}>Admin Panel</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {loading || !stats ? <ActivityIndicator color={colors.brandSecondary} /> : (
          <>
            <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>
              <Stat label="Total Revenue" value={`₹${stats.total_revenue.toFixed(0)}`} color={colors.brandPrimary} />
              <Stat label="Commission (50%)" value={`₹${stats.platform_commission.toFixed(0)}`} color={colors.brandSecondary} />
              <Stat label="Active Drivers" value={stats.active_drivers.toString()} color={colors.info} />
              <Stat label="Bookings" value={stats.total_bookings.toString()} color={colors.warning} />
            </View>

            <Text style={styles.section}>Pending Vehicle Approvals ({stats.pending_approvals})</Text>
            {pending.length === 0 ? <Card><Text style={{ color: colors.muted }}>No pending approvals.</Text></Card> : pending.map(v => (
              <Card key={v.vehicle_id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '800', color: colors.onSurface, fontSize: font.lg }}>{v.model}</Text>
                  <Badge text={v.vehicle_type.toUpperCase()} color={colors.brandPrimary} />
                </View>
                <Text style={{ color: colors.muted, marginTop: 4 }}>{v.number_plate} · {v.total_seats} seats</Text>
                <Text style={{ color: colors.onSurfaceSecondary, marginTop: 2 }}>{v.driver_name} · {v.from_location} → {v.to_location}</Text>
                <Text style={{ color: colors.brandPrimary, marginTop: 4, fontWeight: '700' }}>₹{v.fare_per_seat}/seat</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <Button testID={`approve-${v.vehicle_id}`} title="Approve" onPress={() => act(v.vehicle_id, 'approve')} style={{ flex: 1 }} />
                  <Button testID={`reject-${v.vehicle_id}`} title="Reject" variant="outline" onPress={() => act(v.vehicle_id, 'reject')} style={{ flex: 1 }} />
                </View>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={[styles.stat, { borderLeftColor: color }]}>
      <Text style={{ color: colors.muted, fontSize: font.sm }}>{label}</Text>
      <Text style={{ fontSize: font.xxl, fontWeight: '900', color: colors.onSurface, marginTop: 4 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  h1: { fontSize: font.xl, fontWeight: '800', color: colors.onSurface },
  iconBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface, marginTop: spacing.sm },
  stat: { flexGrow: 1, minWidth: '45%', backgroundColor: '#fff', borderRadius: 16, padding: spacing.md, borderLeftWidth: 4 },
});
