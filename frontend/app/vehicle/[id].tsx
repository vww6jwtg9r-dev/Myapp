import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { api } from '@/src/api';
import { Card, Button, Badge } from '@/src/ui';
import { RouteMap } from '@/src/RouteMap';
import { colors, spacing, font, radius } from '@/src/theme';

type Vehicle = {
  vehicle_id: string; vehicle_type: 'car' | 'tempo' | 'bus';
  model: string; number_plate: string; driver_name: string; rating: number;
  total_seats: number; from_location: string; to_location: string; fare_per_seat: number; departure_time: string;
  driver_verified?: boolean;
};
type Seats = { total_seats: number; booked_seats: number[]; vehicle_type: string };
type Coord = { lat: number; lon: number };

function todayISO() { return new Date().toISOString().slice(0, 10); }

function getLayout(type: string, total: number): { cols: number; groups?: number[] } {
  if (type === 'car') return { cols: 2 };
  if (type === 'tempo') return { cols: 3 };
  return { cols: 4 }; // bus: 2+aisle+2
}

export default function VehicleDetail() {
  const params = useLocalSearchParams<{ id: string; date?: string }>();
  const [v, setV] = useState<Vehicle | null>(null);
  const [seats, setSeats] = useState<Seats | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [date, setDate] = useState<string>(params.date || todayISO());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviews, setReviews] = useState<any[]>([]);
  const [coords, setCoords] = useState<{ from?: Coord; to?: Coord }>({});

  const load = useCallback(async () => {
    try {
      const [vv, ss] = await Promise.all([
        api<Vehicle>(`/vehicles/${params.id}`),
        api<Seats>(`/vehicles/${params.id}/seats?travel_date=${encodeURIComponent(date)}`),
      ]);
      setV(vv); setSeats(ss);
      // fetch reviews + coords in parallel (best-effort)
      api<any[]>(`/reviews/vehicle/${params.id}`).then(setReviews).catch(() => {});
      Promise.all([
        api<Coord>(`/geocode?q=${encodeURIComponent(vv.from_location)}`).catch(() => null),
        api<Coord>(`/geocode?q=${encodeURIComponent(vv.to_location)}`).catch(() => null),
      ]).then(([a, b]) => setCoords({ from: a || undefined, to: b || undefined }));
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [params.id, date]);

  useEffect(() => { load(); }, [load]);

  const toggle = (n: number) => {
    if (!seats) return;
    if (seats.booked_seats.includes(n)) return;
    setSelected(s => s.includes(n) ? s.filter(x => x !== n) : [...s, n].sort((a, b) => a - b));
  };

  const total = useMemo(() => (v?.fare_per_seat || 0) * selected.length, [v, selected]);

  const proceed = async () => {
    if (!selected.length) { setErr('Select at least one seat'); return; }
    try {
      setBusy(true); setErr(null);
      const b: any = await api('/bookings', { method: 'POST', body: JSON.stringify({ vehicle_id: params.id, travel_date: date, seat_numbers: selected }) });
      router.push({ pathname: '/checkout/[id]', params: { id: b.booking_id } });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (loading || !v || !seats) {
    return <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brandSecondary} /></SafeAreaView>;
  }

  const layout = getLayout(v.vehicle_type, v.total_seats);
  const seatSize = v.vehicle_type === 'bus' ? 40 : v.vehicle_type === 'tempo' ? 52 : 60;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={['top']}>
      <View style={styles.head}>
        <Pressable testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.h1}>Select Seats</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 200 }}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: font.xl, fontWeight: '800', color: colors.onSurface }}>{v.model}</Text>
            {v.driver_verified && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${colors.brandSecondary}18`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                <Ionicons name="shield-checkmark" size={14} color={colors.brandSecondary} />
                <Text style={{ fontSize: font.sm, fontWeight: '800', color: colors.brandSecondary }}>Verified</Text>
              </View>
            )}
          </View>
          <Text style={{ color: colors.muted, marginTop: 2 }}>{v.driver_name} · {v.number_plate}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="star" size={14} color={colors.warning} />
              <Text style={{ fontWeight: '700' }}>{v.rating.toFixed(1)}</Text>
            </View>
            <Text style={{ color: colors.muted }}>·</Text>
            <Text style={{ color: colors.onSurfaceSecondary }}>{v.from_location} → {v.to_location}</Text>
          </View>
          <View style={{ marginTop: spacing.md }}>
            <Text style={{ fontSize: font.sm, color: colors.muted, marginBottom: 4 }}>Travel Date</Text>
            <TextInput testID="date-input" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" style={styles.input} placeholderTextColor={colors.muted} />
          </View>
        </Card>

        {coords.from && coords.to && (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <View style={{ padding: spacing.md, paddingBottom: 0 }}>
              <Text style={styles.section}>Route Preview</Text>
            </View>
            <RouteMap
              from={{ lat: coords.from.lat, lon: coords.from.lon, label: v.from_location }}
              to={{ lat: coords.to.lat, lon: coords.to.lon, label: v.to_location }}
            />
          </Card>
        )}

        <Card>
          <Text style={styles.section}>Choose your seats</Text>
          <View style={styles.legend}>
            <LegendDot color={colors.surfaceSecondary} border label="Available" />
            <LegendDot color={colors.brandSecondary} label="Selected" />
            <LegendDot color={colors.surfaceTertiary} label="Booked" />
          </View>
          <View style={styles.busRoof}>
            <Ionicons name="steering-wheel-outline" size={20} color={colors.muted as any} />
            <Text style={{ color: colors.muted, marginLeft: 6 }}>Front</Text>
          </View>
          <View style={[styles.grid, { gap: spacing.sm }]}>
            {Array.from({ length: v.total_seats }, (_, i) => {
              const n = i + 1;
              const isBooked = seats.booked_seats.includes(n);
              const isSel = selected.includes(n);
              const bg = isBooked ? colors.surfaceTertiary : isSel ? colors.brandSecondary : colors.surfaceSecondary;
              const txt = isBooked ? colors.muted : isSel ? '#fff' : colors.onSurface;
              // Bus: aisle after column 2
              const isAisle = v.vehicle_type === 'bus' && (i % layout.cols === 2);
              return (
                <View key={n} style={{ marginLeft: isAisle ? spacing.md : 0 }}>
                  <Pressable
                    testID={`seat-${n}`}
                    onPress={() => toggle(n)}
                    disabled={isBooked}
                    style={[styles.seat, { width: seatSize, height: seatSize, backgroundColor: bg, borderColor: isSel ? colors.brandSecondary : colors.border }]}
                  >
                    <Text style={{ color: txt, fontWeight: '700' }}>{n}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </Card>

        {reviews.length > 0 && (
          <Card>
            <Text style={styles.section}>Reviews ({reviews.length})</Text>
            {reviews.slice(0, 5).map(r => (
              <View key={r.review_id} style={{ paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontWeight: '700', color: colors.onSurface }}>{r.passenger_name}</Text>
                  <View style={{ flexDirection: 'row', gap: 2 }}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Ionicons key={i} name={i < r.stars ? 'star' : 'star-outline'} size={12} color={colors.warning} />
                    ))}
                  </View>
                </View>
                {r.comment ? <Text style={{ color: colors.onSurfaceSecondary, marginTop: 4 }}>{r.comment}</Text> : null}
              </View>
            ))}
          </Card>
        )}

        {err && <Text style={{ color: colors.error }}>{err}</Text>}
      </ScrollView>

      <View style={styles.bar}>
        <View>
          <Text style={{ color: colors.muted, fontSize: font.sm }}>{selected.length} seat(s) · {selected.join(', ') || '—'}</Text>
          <Text style={{ fontSize: font.xxl, fontWeight: '900', color: colors.onSurface }}>₹{total}</Text>
        </View>
        <Button testID="continue-checkout-button" title="Continue" onPress={proceed} disabled={!selected.length} loading={busy} style={{ paddingHorizontal: 28 }} />
      </View>
    </SafeAreaView>
  );
}

function LegendDot({ color, label, border }: { color: string; label: string; border?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 16, height: 16, borderRadius: 6, backgroundColor: color, borderWidth: border ? 1 : 0, borderColor: colors.border }} />
      <Text style={{ fontSize: font.sm, color: colors.onSurfaceSecondary }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  h1: { fontSize: font.xl, fontWeight: '800', color: colors.onSurface },
  iconBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface, marginBottom: spacing.sm },
  legend: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md, flexWrap: 'wrap' },
  busRoof: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  seat: { borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', padding: spacing.lg, paddingBottom: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.divider },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, fontSize: font.lg, color: colors.onSurface },
});
