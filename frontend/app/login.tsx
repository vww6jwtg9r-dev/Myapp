import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth';
import { Button } from '@/src/ui';
import { colors, radius, spacing, font } from '@/src/theme';
import { router } from 'expo-router';

type Mode = 'choice' | 'phone' | 'otp';

export default function Login() {
  const { loginWithGoogle, sendOtp, verifyOtp, user } = useAuth();
  const [mode, setMode] = useState<Mode>('choice');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (user) router.replace(user.picture ? '/(tabs)' : '/onboarding');
  }, [user]);

  const doGoogle = async () => {
    try { setBusy(true); setErr(null); await loginWithGoogle(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const doSend = async () => {
    if (!phone.trim()) { setErr('Enter phone number'); return; }
    try { setBusy(true); setErr(null); const c = await sendOtp(phone.trim()); setHint(c ? `Use OTP: ${c}` : null); setMode('otp'); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const doVerify = async () => {
    try { setBusy(true); setErr(null); await verifyOtp(phone.trim(), code.trim(), name.trim() || undefined); router.replace('/onboarding'); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.brandPrimary }}>
      <LinearGradient
        colors={[colors.brandPrimary, '#0F2A47']}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.xl }} keyboardShouldPersistTaps="handled">
            <View style={{ marginTop: spacing.xxl, alignItems: 'center' }}>
              <View style={styles.logoWrap}>
                <Ionicons name="car-sport" size={40} color={colors.brandSecondary} />
              </View>
              <Text style={styles.brand}>RideReserve</Text>
              <Text style={styles.tagline}>Book seats. Share rides. Save more.</Text>
            </View>

            <View style={{ marginTop: spacing.xxxl, gap: spacing.md }}>
              {mode === 'choice' && (
                <>
                  <Button
                    testID="login-google-button"
                    title="Continue with Google"
                    variant="primary"
                    onPress={doGoogle}
                    loading={busy}
                    icon={<Ionicons name="logo-google" size={20} color="#fff" />}
                  />
                  <View style={styles.divider}>
                    <View style={styles.line} /><Text style={{ color: '#ffffff80' }}>OR</Text><View style={styles.line} />
                  </View>
                  <Button
                    testID="login-phone-button"
                    title="Continue with Phone"
                    variant="outline"
                    onPress={() => setMode('phone')}
                    icon={<Ionicons name="call-outline" size={20} color="#fff" />}
                    textStyle={{ color: '#fff' }}
                    style={{ borderColor: '#ffffff40' }}
                  />
                </>
              )}

              {mode === 'phone' && (
                <>
                  <Text style={styles.label}>Phone Number</Text>
                  <TextInput
                    testID="login-phone-input"
                    placeholder="+91 98765 43210"
                    placeholderTextColor="#ffffff60"
                    keyboardType="phone-pad"
                    value={phone}
                    onChangeText={setPhone}
                    style={styles.input}
                  />
                  <Button testID="login-send-otp-button" title="Send OTP" onPress={doSend} loading={busy} />
                  <Pressable onPress={() => setMode('choice')}><Text style={styles.back}>← Back</Text></Pressable>
                </>
              )}

              {mode === 'otp' && (
                <>
                  <Text style={styles.label}>Enter 6-digit OTP</Text>
                  {hint && <Text style={{ color: colors.warning, marginBottom: spacing.xs }}>{hint}</Text>}
                  <TextInput
                    testID="login-otp-input"
                    placeholder="123456"
                    placeholderTextColor="#ffffff60"
                    keyboardType="number-pad"
                    maxLength={6}
                    value={code}
                    onChangeText={setCode}
                    style={styles.input}
                  />
                  <Text style={styles.label}>Your Name (optional)</Text>
                  <TextInput
                    testID="login-name-input"
                    placeholder="Full Name"
                    placeholderTextColor="#ffffff60"
                    value={name}
                    onChangeText={setName}
                    style={styles.input}
                  />
                  <Button testID="login-verify-otp-button" title="Verify & Login" onPress={doVerify} loading={busy} />
                  <Pressable onPress={() => setMode('phone')}><Text style={styles.back}>← Change number</Text></Pressable>
                </>
              )}

              {err && <Text style={{ color: colors.warning, marginTop: spacing.sm }}>{err}</Text>}
            </View>

            <Text style={styles.legal}>By continuing, you agree to Terms & Privacy Policy</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  logoWrap: { width: 84, height: 84, borderRadius: 24, backgroundColor: '#ffffff10', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff20', marginBottom: spacing.lg },
  brand: { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  tagline: { color: '#ffffffb0', marginTop: 6 },
  label: { color: '#ffffffc0', fontSize: font.sm, marginBottom: 6, marginTop: spacing.sm },
  input: { backgroundColor: '#ffffff12', borderRadius: radius.md, borderWidth: 1, borderColor: '#ffffff20', paddingHorizontal: spacing.lg, paddingVertical: 14, color: '#fff', fontSize: font.lg },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.md },
  line: { flex: 1, height: 1, backgroundColor: '#ffffff20' },
  back: { color: '#ffffffb0', textAlign: 'center', marginTop: spacing.md },
  legal: { color: '#ffffff80', textAlign: 'center', marginTop: 'auto', fontSize: font.sm, paddingTop: spacing.xxl },
});
