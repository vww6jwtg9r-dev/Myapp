import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Share, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api } from '@/src/api';
import { Card, Button } from '@/src/ui';
import { colors, spacing, font, radius } from '@/src/theme';

type Info = { referral_code: string; referred_by: string | null; invited: number; earned: number; bonus: number };

export default function Referrals() {
  const [info, setInfo] = useState<Info | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setInfo(await api<Info>('/referrals/me')); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const share = async () => {
    if (!info) return;
    const text = `Sign up on RideReserve with my code ${info.referral_code} and we both get ₹${info.bonus.toFixed(0)} after your first ride!`;
    if (Platform.OS === 'web') {
      try { await (navigator as any).clipboard?.writeText(text); setMsg('Copied to clipboard!'); } catch {}
    } else {
      await Share.share({ message: text });
    }
  };

  const apply = async () => {
    setErr(null); setMsg(null);
    try {
      setBusy(true);
      const res: any = await api('/referrals/apply', { method: 'POST', body: JSON.stringify({ code: code.trim().toUpperCase() }) });
      setMsg(res.message);
      setCode('');
      load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (!info) return <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brandSecondary} /></SafeAreaView>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.h1}>Refer & Earn</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <Card style={{ backgroundColor: colors.brandPrimary, alignItems: 'center' }}>
          <Ionicons name="gift" size={40} color={colors.warning} />
          <Text style={{ color: '#ffffffb0', marginTop: spacing.sm }}>Earn per referral</Text>
          <Text style={{ color: '#fff', fontSize: 40, fontWeight: '900' }}>₹{info.bonus.toFixed(0)}</Text>
          <Text style={{ color: '#ffffffb0', fontSize: font.sm, textAlign: 'center', marginTop: 4 }}>
            You both get ₹{info.bonus.toFixed(0)} after your friend's first paid ride.
          </Text>
        </Card>

        <Card>
          <Text style={{ color: colors.muted, fontSize: font.sm }}>Your Referral Code</Text>
          <Text testID="my-referral-code" style={styles.code}>{info.referral_code}</Text>
          <Button testID="share-referral" title="Share with Friends" onPress={share} icon={<Ionicons name="share-social" size={18} color="#fff" />} />
        </Card>

        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Card style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.stat}>{info.invited}</Text>
            <Text style={{ color: colors.muted, fontSize: font.sm }}>Friends invited</Text>
          </Card>
          <Card style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.stat}>₹{info.earned.toFixed(0)}</Text>
            <Text style={{ color: colors.muted, fontSize: font.sm }}>Bonuses earned</Text>
          </Card>
        </View>

        {!info.referred_by ? (
          <Card>
            <Text style={styles.section}>Have a referral code?</Text>
            <Text style={{ color: colors.muted, marginTop: 4, marginBottom: spacing.md, fontSize: font.sm }}>
              Enter a friend's code and you both get ₹{info.bonus.toFixed(0)} after your first paid ride.
            </Text>
            <TextInput testID="ref-input" value={code} onChangeText={setCode} placeholder="RR-XXXXXX" autoCapitalize="characters" style={styles.input} placeholderTextColor={colors.muted} />
            {err && <Text style={{ color: colors.error, marginTop: spacing.sm }}>{err}</Text>}
            {msg && <Text style={{ color: colors.brandSecondary, marginTop: spacing.sm }}>{msg}</Text>}
            <Button testID="apply-ref" title="Apply Code" onPress={apply} loading={busy} style={{ marginTop: spacing.md }} />
          </Card>
        ) : (
          <Card>
            <Text style={{ color: colors.brandSecondary, fontWeight: '700' }}>✓ Referral code applied: {info.referred_by}</Text>
            <Text style={{ color: colors.muted, marginTop: 4, fontSize: font.sm }}>Bonus will unlock after your first paid ride.</Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  h1: { fontSize: font.xl, fontWeight: '800', color: colors.onSurface },
  iconBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface },
  code: { fontSize: 32, fontWeight: '900', color: colors.brandPrimary, letterSpacing: 4, textAlign: 'center', marginVertical: spacing.md },
  stat: { fontSize: font.xxl, fontWeight: '900', color: colors.onSurface },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, fontSize: font.lg, color: colors.onSurface, letterSpacing: 2 },
});
