import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { api } from '@/src/api';
import { Card, Button, Badge } from '@/src/ui';
import { colors, spacing, font, radius } from '@/src/theme';

type Booking = {
  booking_id: string; travel_date: string; seat_numbers: number[]; total_amount: number; status: string; passenger_name: string;
  vehicle?: { model: string; from_location: string; to_location: string; departure_time: string; driver_name: string; driver_phone?: string | null; number_plate: string; };
};

export default function Ticket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [b, setB] = useState<Booking | null>(null);

  const load = useCallback(async () => {
    try { setB(await api<Booking>(`/bookings/${id}`)); } catch (e) { console.log(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!b) return <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brandSecondary} /></SafeAreaView>;

  const callDriver = () => {
    if (b.vehicle?.driver_phone) Linking.openURL(`tel:${b.vehicle.driver_phone}`);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.brandPrimary }} edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.replace('/(tabs)/bookings')} style={styles.iconBtn}><Ionicons name="close" size={22} color="#fff" /></Pressable>
        <Text style={styles.h1}>E-Ticket</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={styles.ticket}>
          <View style={styles.ticketTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Badge text="CONFIRMED" color={colors.brandSecondary} />
              <Text style={{ color: colors.muted, fontSize: font.sm }}>{b.booking_id}</Text>
            </View>
            <Text style={styles.route}>{b.vehicle?.from_location} → {b.vehicle?.to_location}</Text>
            <Text style={{ color: colors.muted, marginTop: 4 }}>{b.vehicle?.model} · {b.vehicle?.number_plate}</Text>

            <View style={styles.details}>
              <Detail label="Date" value={b.travel_date} />
              <Detail label="Dep" value={b.vehicle?.departure_time || '—'} />
              <Detail label="Seats" value={b.seat_numbers.join(', ')} />
            </View>

            <View style={styles.details}>
              <Detail label="Passenger" value={b.passenger_name} />
              <Detail label="Amount" value={`₹${b.total_amount.toFixed(0)}`} />
            </View>
          </View>

          <View style={styles.perf}>
            {Array.from({ length: 18 }).map((_, i) => <View key={i} style={styles.perfDot} />)}
          </View>

          <View style={styles.qrWrap}>
            <QRCode value={b.booking_id} size={160} color={colors.brandPrimary} />
            <Text style={{ color: colors.muted, marginTop: spacing.sm, fontSize: font.sm }}>Show at boarding</Text>
          </View>
        </View>

        <Card>
          <Text style={styles.section}>Driver</Text>
          <Text style={{ fontWeight: '700', color: colors.onSurface, fontSize: font.lg }}>{b.vehicle?.driver_name}</Text>
          {b.vehicle?.driver_phone ? (
            <>
              <Text style={{ color: colors.muted, marginTop: 4 }}>{b.vehicle.driver_phone}</Text>
              <Button testID="call-driver-button" title="Call Driver" onPress={callDriver} style={{ marginTop: spacing.md }} icon={<Ionicons name="call" size={18} color="#fff" />} />
            </>
          ) : (
            <Text style={{ color: colors.muted, marginTop: 4 }}>Driver contact will be revealed after payment.</Text>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.muted, fontSize: font.sm }}>{label}</Text>
      <Text style={{ color: colors.onSurface, fontWeight: '700', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  h1: { fontSize: font.xl, fontWeight: '800', color: '#fff' },
  iconBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#ffffff20', alignItems: 'center', justifyContent: 'center' },
  ticket: { backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden' },
  ticketTop: { padding: spacing.xl },
  route: { fontSize: font.xxl, fontWeight: '900', color: colors.brandPrimary, marginTop: spacing.md },
  details: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  perf: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6, backgroundColor: colors.brandPrimary },
  perfDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.surfaceSecondary, marginVertical: -7 },
  qrWrap: { alignItems: 'center', padding: spacing.xl, paddingTop: spacing.xxl },
  section: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface, marginBottom: spacing.sm },
});
