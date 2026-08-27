import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, TextInput, Pressable, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, router } from 'expo-router';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { Card, Button, EmptyState, Badge } from '@/src/ui';
import { colors, spacing, font, radius } from '@/src/theme';

type Txn = { txn_id: string; type: 'credit' | 'debit' | 'commission'; amount: number; note: string; created_at: string; booking_id?: string };
type DriverBooking = { booking_id: string; seat_numbers: number[]; travel_date: string; passenger_name: string; passenger_phone?: string; driver_earning: number; route?: string; vehicle_model?: string };

export default function Wallet() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [driverBookings, setDriverBookings] = useState<DriverBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [amount, setAmount] = useState('');
  const [upi, setUpi] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDriver = user?.active_role === 'driver';

  const load = useCallback(async () => {
    try {
      const w: any = await api('/wallet/me');
      setBalance(w.balance || 0);
      setTxns(w.transactions || []);
      if (isDriver) {
        try { setDriverBookings(await api<DriverBooking[]>('/bookings/driver/list')); } catch {}
      }
    } catch (e) { console.log(e); } finally { setLoading(false); setRefreshing(false); }
  }, [isDriver]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const doWithdraw = async () => {
    setErr(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setErr('Enter valid amount'); return; }
    if (!upi.trim()) { setErr('Enter UPI ID'); return; }
    try {
      setBusy(true);
      await api('/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount: amt, upi_id: upi.trim() }) });
      setShowWithdraw(false); setAmount(''); setUpi('');
      load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={['top']}>
      <View style={styles.head}><Text style={styles.h1}>{isDriver ? 'Earnings' : 'Wallet'}</Text></View>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {loading ? <ActivityIndicator color={colors.brandSecondary} /> : (
          <>
            <Card style={{ backgroundColor: colors.brandPrimary }}>
              <Text style={{ color: '#ffffffb0' }}>{isDriver ? 'Available to withdraw' : 'Wallet Balance'}</Text>
              <Text style={styles.big}>₹{balance.toFixed(2)}</Text>
              {isDriver && (
                <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                  <Button testID="wallet-withdraw-button" title="Withdraw to UPI" variant="primary" onPress={() => setShowWithdraw(true)} style={{ flex: 1 }} />
                  <Button title="Add Vehicle" variant="outline" textStyle={{ color: '#fff' }} style={{ borderColor: '#ffffff40', flex: 1 }} onPress={() => router.push('/driver/register')} />
                </View>
              )}
            </Card>

            {isDriver && (
              <>
                <Text style={styles.section}>Upcoming Trips</Text>
                {driverBookings.length === 0 ? (
                  <Card><Text style={{ color: colors.muted }}>No paid bookings yet.</Text></Card>
                ) : driverBookings.map(b => (
                  <Card key={b.booking_id}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontWeight: '700', color: colors.onSurface }}>{b.route}</Text>
                      <Badge text={`+₹${b.driver_earning}`} color={colors.brandSecondary} />
                    </View>
                    <Text style={{ color: colors.muted, marginTop: 4 }}>{b.travel_date} · {b.vehicle_model}</Text>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: spacing.sm }}>
                      <Ionicons name="person" size={14} color={colors.brandPrimary} />
                      <Text style={{ color: colors.onSurfaceSecondary }}>{b.passenger_name} · Seats {b.seat_numbers.join(', ')}</Text>
                    </View>
                    {b.passenger_phone && <Text style={{ color: colors.muted, fontSize: font.sm, marginTop: 2 }}>{b.passenger_phone}</Text>}
                  </Card>
                ))}
              </>
            )}

            <Text style={styles.section}>Recent Transactions</Text>
            {txns.length === 0 ? <EmptyState title="No transactions" /> : txns.map(t => (
              <Card key={t.txn_id} style={{ padding: spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600', color: colors.onSurface }}>{t.note}</Text>
                    <Text style={{ color: colors.muted, fontSize: font.sm, marginTop: 2 }}>{new Date(t.created_at).toLocaleString()}</Text>
                  </View>
                  <Text style={{ fontWeight: '800', color: t.type === 'credit' ? colors.brandSecondary : colors.error }}>
                    {t.type === 'credit' ? '+' : '-'}₹{t.amount.toFixed(2)}
                  </Text>
                </View>
              </Card>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={showWithdraw} transparent animationType="slide" onRequestClose={() => setShowWithdraw(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1, backgroundColor: '#00000060' }} onPress={() => setShowWithdraw(false)} />
          <View style={styles.sheet}>
            <Text style={{ fontSize: font.xl, fontWeight: '800', color: colors.onSurface, marginBottom: spacing.md }}>Withdraw to UPI</Text>
            <TextInput value={amount} onChangeText={setAmount} placeholder="Amount ₹" keyboardType="numeric" style={styles.input} placeholderTextColor={colors.muted} testID="withdraw-amount" />
            <TextInput value={upi} onChangeText={setUpi} placeholder="UPI ID (yourname@bank)" style={styles.input} placeholderTextColor={colors.muted} testID="withdraw-upi" />
            {err && <Text style={{ color: colors.error, marginTop: spacing.sm }}>{err}</Text>}
            <Button testID="withdraw-submit" title="Withdraw Now" onPress={doWithdraw} loading={busy} style={{ marginTop: spacing.md }} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  h1: { fontSize: font.xxl, fontWeight: '800', color: colors.onSurface },
  big: { fontSize: 40, fontWeight: '900', color: '#fff', marginTop: 4 },
  section: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface, marginTop: spacing.md },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.xl, gap: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm, fontSize: font.lg, color: colors.onSurface },
});
