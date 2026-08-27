import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api } from '@/src/api';
import { Card, Button, Badge } from '@/src/ui';
import { colors, spacing, font, radius } from '@/src/theme';

const TYPES: { key: 'car' | 'tempo' | 'bus'; label: string; seats: number }[] = [
  { key: 'car', label: 'Car', seats: 4 },
  { key: 'tempo', label: 'Tempo', seats: 12 },
  { key: 'bus', label: 'Bus', seats: 32 },
];

type Vehicle = {
  vehicle_id: string; vehicle_type: string; model: string; number_plate: string;
  total_seats: number; from_location: string; to_location: string; fare_per_seat: number;
  departure_time: string; status: string;
};

export default function DriverRegister() {
  const [type, setType] = useState<'car' | 'tempo' | 'bus'>('car');
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');
  const [seats, setSeats] = useState('4');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fare, setFare] = useState('');
  const [time, setTime] = useState('07:30');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [items, setItems] = useState<Vehicle[]>([]);

  const loadMine = useCallback(async () => {
    try { setItems(await api<Vehicle[]>('/vehicles/mine')); } catch (e) { console.log(e); }
  }, []);
  useEffect(() => { loadMine(); }, [loadMine]);

  const submit = async () => {
    setErr(null); setOk(null);
    if (!model || !plate || !from || !to || !fare) { setErr('Fill all fields'); return; }
    try {
      setBusy(true);
      await api('/vehicles', { method: 'POST', body: JSON.stringify({
        vehicle_type: type, model, number_plate: plate,
        total_seats: parseInt(seats, 10) || TYPES.find(t => t.key === type)!.seats,
        from_location: from, to_location: to, fare_per_seat: parseFloat(fare), departure_time: time,
      }) });
      setOk('Vehicle submitted for approval');
      setModel(''); setPlate(''); setFrom(''); setTo(''); setFare('');
      loadMine();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.h1}>My Vehicles</Text>
        <View style={{ width: 40 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}>
          <Card>
            <Text style={styles.section}>Register New Vehicle</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
              {TYPES.map(t => (
                <Pressable
                  key={t.key}
                  testID={`type-${t.key}`}
                  onPress={() => { setType(t.key); setSeats(String(t.seats)); }}
                  style={[styles.typeBtn, type === t.key && styles.typeActive]}
                >
                  <Text style={[styles.typeTxt, type === t.key && { color: '#fff' }]}>{t.label}</Text>
                  <Text style={[{ fontSize: font.sm, color: type === t.key ? '#ffffffb0' : colors.muted }]}>{t.seats} seats</Text>
                </Pressable>
              ))}
            </View>

            <Input testID="veh-model" label="Vehicle Model" value={model} onChangeText={setModel} placeholder="e.g. Honda Amaze" />
            <Input testID="veh-plate" label="Number Plate" value={plate} onChangeText={setPlate} placeholder="KA01AB1234" autoCapitalize="characters" />
            <Input testID="veh-seats" label="Total Seats" value={seats} onChangeText={setSeats} placeholder="4" keyboardType="numeric" />
            <Input testID="veh-from" label="From" value={from} onChangeText={setFrom} placeholder="Bangalore" />
            <Input testID="veh-to" label="To" value={to} onChangeText={setTo} placeholder="Mysore" />
            <Input testID="veh-fare" label="Fare per Seat (₹)" value={fare} onChangeText={setFare} placeholder="450" keyboardType="numeric" />
            <Input testID="veh-time" label="Departure Time" value={time} onChangeText={setTime} placeholder="07:30" />

            {err && <Text style={{ color: colors.error, marginTop: spacing.sm }}>{err}</Text>}
            {ok && <Text style={{ color: colors.brandSecondary, marginTop: spacing.sm }}>{ok}</Text>}

            <Button testID="veh-submit" title="Submit for Approval" onPress={submit} loading={busy} style={{ marginTop: spacing.md }} />
          </Card>

          <Text style={styles.section}>My Listings</Text>
          {items.length === 0 ? <Card><Text style={{ color: colors.muted }}>No vehicles yet.</Text></Card> : items.map(v => (
            <Card key={v.vehicle_id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '800', color: colors.onSurface }}>{v.model}</Text>
                <Badge text={v.status.toUpperCase()} color={v.status === 'approved' ? colors.brandSecondary : v.status === 'pending' ? colors.warning : colors.error} />
              </View>
              <Text style={{ color: colors.muted, marginTop: 4 }}>{v.number_plate} · {v.total_seats} seats · {v.vehicle_type}</Text>
              <Text style={{ color: colors.onSurfaceSecondary, marginTop: 4 }}>{v.from_location} → {v.to_location} · Dep {v.departure_time}</Text>
              <Text style={{ color: colors.brandPrimary, marginTop: 4, fontWeight: '700' }}>₹{v.fare_per_seat}/seat</Text>
            </Card>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Input({ label, testID, ...p }: any) {
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Text style={{ fontSize: font.sm, color: colors.muted, marginBottom: 4 }}>{label}</Text>
      <TextInput testID={testID} {...p} placeholderTextColor={colors.muted} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  h1: { fontSize: font.xl, fontWeight: '800', color: colors.onSurface },
  iconBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface, marginBottom: spacing.sm },
  typeBtn: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, alignItems: 'center' },
  typeActive: { backgroundColor: colors.brandPrimary },
  typeTxt: { fontWeight: '700', color: colors.onSurface },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, fontSize: font.lg, color: colors.onSurface },
});
