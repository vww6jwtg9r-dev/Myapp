import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { api } from '@/src/api';
import { Card, Button } from '@/src/ui';
import { colors, spacing, font, radius } from '@/src/theme';

type Booking = {
  booking_id: string; travel_date: string; seat_numbers: number[]; total_amount: number;
  driver_earning: number; platform_commission: number; status: string; seat_count: number;
  vehicle?: { model: string; from_location: string; to_location: string; departure_time: string; driver_name: string; };
};

const METHODS: { key: 'gpay' | 'phonepe' | 'upi'; label: string; icon: any; color: string }[] = [
  { key: 'gpay', label: 'Google Pay', icon: 'logo-google', color: '#4285F4' },
  { key: 'phonepe', label: 'PhonePe', icon: 'phone-portrait', color: '#5F259F' },
  { key: 'upi', label: 'Other UPI', icon: 'card-outline', color: colors.brandPrimary },
];

export default function Checkout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [b, setB] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState<'gpay' | 'phonepe' | 'upi'>('gpay');
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setB(await api<Booking>(`/bookings/${id}`)); } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const pay = async () => {
    try {
      setPaying(true); setErr(null);
      await api(`/bookings/${id}/pay`, { method: 'POST', body: JSON.stringify({ method }) });
      router.replace({ pathname: '/ticket/[id]', params: { id: id as string } });
    } catch (e: any) { setErr(e.message); } finally { setPaying(false); }
  };

  if (loading || !b) return <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brandSecondary} /></SafeAreaView>;

  const fare = b.total_amount / b.seat_count;
  const tax = 0; // demo: taxes included

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.h1}>Checkout</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 200 }}>
        <Card>
          <Text style={{ fontSize: font.lg, fontWeight: '800', color: colors.onSurface }}>{b.vehicle?.model}</Text>
          <Text style={{ color: colors.muted, marginTop: 2 }}>{b.vehicle?.driver_name}</Text>
          <View style={{ marginTop: spacing.md, gap: 4 }}>
            <Text style={{ fontWeight: '700', color: colors.onSurface }}>{b.vehicle?.from_location} → {b.vehicle?.to_location}</Text>
            <Text style={{ color: colors.muted }}>{b.travel_date} · Dep {b.vehicle?.departure_time}</Text>
            <Text style={{ color: colors.muted }}>Seats: {b.seat_numbers.join(', ')}</Text>
          </View>
        </Card>

        <Card>
          <Text style={styles.section}>Fare Breakdown</Text>
          <Row label={`Base fare (${b.seat_count} × ₹${fare.toFixed(0)})`} value={`₹${b.total_amount.toFixed(2)}`} />
          <Row label="Taxes & fees" value={`₹${tax.toFixed(2)}`} />
          <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm }} />
          <Row label="Total" value={`₹${b.total_amount.toFixed(2)}`} bold />
        </Card>

        <Card>
          <Text style={styles.section}>Payment Method</Text>
          <Text style={{ color: colors.muted, marginBottom: spacing.sm, fontSize: font.sm }}>DEMO: mocked UPI payment for prototype.</Text>
          {METHODS.map(m => (
            <Pressable key={m.key} testID={`pay-${m.key}`} onPress={() => setMethod(m.key)} style={[styles.methodRow, method === m.key && styles.methodActive]}>
              <View style={[styles.methodIcon, { backgroundColor: `${m.color}18` }]}><Ionicons name={m.icon} size={20} color={m.color} /></View>
              <Text style={{ flex: 1, fontWeight: '600', color: colors.onSurface }}>{m.label}</Text>
              <Ionicons name={method === m.key ? 'radio-button-on' : 'radio-button-off'} size={22} color={method === m.key ? colors.brandSecondary : colors.borderStrong} />
            </Pressable>
          ))}
        </Card>

        {err && <Text style={{ color: colors.error }}>{err}</Text>}
      </ScrollView>

      <View style={styles.bar}>
        <View>
          <Text style={{ color: colors.muted, fontSize: font.sm }}>Total payable</Text>
          <Text style={{ fontSize: font.xxl, fontWeight: '900', color: colors.onSurface }}>₹{b.total_amount.toFixed(2)}</Text>
        </View>
        <Button testID="pay-now-button" title={`Pay ₹${b.total_amount.toFixed(0)}`} onPress={pay} loading={paying} style={{ paddingHorizontal: 28 }} />
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
      <Text style={{ color: bold ? colors.onSurface : colors.onSurfaceSecondary, fontWeight: bold ? '800' : '500', fontSize: bold ? font.lg : font.base }}>{label}</Text>
      <Text style={{ color: colors.onSurface, fontWeight: bold ? '800' : '600', fontSize: bold ? font.lg : font.base }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  h1: { fontSize: font.xl, fontWeight: '800', color: colors.onSurface },
  iconBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface, marginBottom: spacing.sm },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, marginBottom: spacing.sm, borderWidth: 1, borderColor: 'transparent' },
  methodActive: { borderColor: colors.brandSecondary, backgroundColor: '#05A35710' },
  methodIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', padding: spacing.lg, paddingBottom: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.divider },
});
