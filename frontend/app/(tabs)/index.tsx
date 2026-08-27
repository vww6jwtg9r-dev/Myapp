import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/src/auth';
import { api, fileUrl } from '@/src/api';
import { Card, Badge, EmptyState } from '@/src/ui';
import { colors, radius, spacing, font, shadow } from '@/src/theme';

type Vehicle = {
  vehicle_id: string; vehicle_type: 'car' | 'tempo' | 'bus';
  model: string; number_plate: string; driver_name: string; driver_picture?: string | null;
  rating: number; total_seats: number; seats_available: number;
  from_location: string; to_location: string; fare_per_seat: number; departure_time: string;
};

const TYPES: { key: 'all' | 'car' | 'tempo' | 'bus'; label: string; icon: any }[] = [
  { key: 'all', label: 'All', icon: 'grid-outline' },
  { key: 'car', label: 'Car', icon: 'car-sport-outline' },
  { key: 'tempo', label: 'Tempo', icon: 'bus-outline' },
  { key: 'bus', label: 'Bus', icon: 'bus' },
];

function todayISO() { return new Date().toISOString().slice(0, 10); }

export default function Home() {
  const { user } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState<'all' | 'car' | 'tempo' | 'bus'>('all');
  const [items, setItems] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      if (date) qs.set('travel_date', date);
      if (type !== 'all') qs.set('vehicle_type', type);
      const list = await api<Vehicle[]>(`/vehicles/search?${qs.toString()}`);
      setItems(list);
    } catch (e) { console.log(e); } finally { setLoading(false); setRefreshing(false); }
  }, [from, to, date, type]);

  useEffect(() => { load(); }, [type]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        stickyHeaderIndices={[0]}
      >
        {/* Sticky Header */}
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
            <View>
              <Text style={styles.hi}>Hi, {user?.name?.split(' ')[0] || 'Traveler'} 👋</Text>
              <Text style={styles.subtle}>Where are you going?</Text>
            </View>
            {user?.picture ? (
              <Image source={{ uri: fileUrl(user.picture) }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="person" size={20} color="#fff" />
              </View>
            )}
          </View>

          <Card style={{ padding: spacing.md }}>
            <SearchRow icon="location" placeholder="From city" value={from} onChangeText={setFrom} testID="home-from-input" />
            <View style={styles.sep} />
            <SearchRow icon="navigate" placeholder="To city" value={to} onChangeText={setTo} testID="home-to-input" />
            <View style={styles.sep} />
            <SearchRow icon="calendar" placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} testID="home-date-input" />
            <Pressable testID="home-search-button" onPress={load} style={styles.searchBtn}>
              <Ionicons name="search" size={18} color="#fff" />
              <Text style={styles.searchBtnTxt}>Search Rides</Text>
            </Pressable>
          </Card>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: 2, paddingVertical: spacing.md }}
            style={{ marginTop: spacing.xs }}
          >
            {TYPES.map(t => {
              const active = type === t.key;
              return (
                <Pressable
                  key={t.key}
                  testID={`home-filter-${t.key}`}
                  onPress={() => setType(t.key)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Ionicons name={t.icon} size={14} color={active ? '#fff' : colors.onSurface} />
                  <Text style={[styles.chipTxt, active && { color: '#fff' }]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {loading ? (
            <View style={{ padding: spacing.xxxl }}><ActivityIndicator color={colors.brandSecondary} /></View>
          ) : items.length === 0 ? (
            <EmptyState title="No rides found" subtitle="Try changing the route or date." />
          ) : items.map(v => <VehicleCard key={v.vehicle_id} v={v} onPress={() => router.push({ pathname: '/vehicle/[id]', params: { id: v.vehicle_id, date } })} />)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SearchRow({ icon, ...p }: any) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Ionicons name={icon} size={18} color={colors.brandSecondary} />
      <TextInput {...p} placeholderTextColor={colors.muted} style={{ flex: 1, fontSize: font.lg, color: colors.onSurface, paddingVertical: 10 }} />
    </View>
  );
}

function VehicleCard({ v, onPress }: { v: Vehicle; onPress: () => void }) {
  return (
    <Pressable testID={`vehicle-card-${v.vehicle_id}`} onPress={onPress}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={styles.driverAv}>
            {v.driver_picture ? <Image source={{ uri: fileUrl(v.driver_picture) }} style={styles.driverAv} /> :
              <Ionicons name="person" size={22} color="#fff" />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: font.lg, fontWeight: '700', color: colors.onSurface }}>{v.model}</Text>
            <Text style={{ color: colors.muted, fontSize: font.sm }}>{v.driver_name} · {v.number_plate}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="star" size={14} color={colors.warning} />
            <Text style={{ fontWeight: '700', color: colors.onSurface }}>{v.rating.toFixed(1)}</Text>
          </View>
        </View>

        <View style={styles.route}>
          <View style={{ alignItems: 'center' }}>
            <View style={styles.dot} />
            <View style={styles.dashLine} />
            <View style={[styles.dot, { backgroundColor: colors.brandSecondary }]} />
          </View>
          <View style={{ flex: 1, gap: spacing.md, marginLeft: spacing.md }}>
            <View>
              <Text style={styles.city}>{v.from_location}</Text>
              <Text style={styles.time}>Dep {v.departure_time}</Text>
            </View>
            <View>
              <Text style={styles.city}>{v.to_location}</Text>
              <Text style={styles.time}>{v.vehicle_type.toUpperCase()}</Text>
            </View>
          </View>
        </View>

        <View style={styles.cardFoot}>
          <Badge text={`${v.seats_available}/${v.total_seats} seats`} color={v.seats_available > 0 ? colors.brandSecondary : colors.error} />
          <Text style={styles.price}>₹{v.fare_per_seat}<Text style={styles.priceUnit}>/seat</Text></Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, paddingTop: spacing.sm },
  hi: { fontSize: font.xl, fontWeight: '800', color: colors.onSurface },
  subtle: { color: colors.muted, marginTop: 2 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary },
  sep: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },
  searchBtn: { marginTop: spacing.md, backgroundColor: colors.brandSecondary, borderRadius: radius.md, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  searchBtnTxt: { color: '#fff', fontWeight: '700', fontSize: font.lg },
  chip: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipTxt: { fontWeight: '600', color: colors.onSurface, fontSize: font.sm },
  driverAv: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  route: { flexDirection: 'row', marginTop: spacing.md, paddingHorizontal: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  dashLine: { width: 1, flex: 1, backgroundColor: colors.borderStrong, marginVertical: 4, minHeight: 24 },
  city: { fontSize: font.base, fontWeight: '700', color: colors.onSurface },
  time: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  price: { fontSize: font.xl, fontWeight: '800', color: colors.brandPrimary },
  priceUnit: { fontSize: font.sm, color: colors.muted, fontWeight: '500' },
});
