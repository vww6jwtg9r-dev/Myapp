import { useCallback, useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { api } from '@/src/api';
import { colors, spacing, font } from '@/src/theme';

type OrderInfo = { requires_action: string; key_id: string; order_id: string; amount: number; currency: string; booking_id: string; prefill: { name: string; email?: string; contact?: string } };

export default function RazorpayScreen() {
  const params = useLocalSearchParams<{ order_id: string; booking_id: string; key_id: string; amount: string; currency: string; name: string; email: string; contact: string }>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'verifying' | 'done' | 'error'>('ready');
  const [err, setErr] = useState<string | null>(null);
  const webRef = useRef<WebView>(null);

  const amount = parseInt(params.amount || '0', 10);
  // SEC-005: escape strings before injecting into inline <script>
  const jsSafe = (v: string) => JSON.stringify(String(v || '')).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const html = `<!doctype html><html><head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>body{margin:0;background:#0B192C;color:#fff;font-family:system-ui;text-align:center;padding-top:40vh}</style>
  </head><body>
    <div>Opening Razorpay Checkout…</div>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <script>
      const post = (m) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m));
      const options = {
        key: ${jsSafe(params.key_id as string)},
        amount: ${Number(amount) || 0},
        currency: ${jsSafe(params.currency as string)},
        name: "RideReserve",
        description: "Seat booking",
        order_id: ${jsSafe(params.order_id as string)},
        prefill: { name: ${jsSafe((params.name as string) || '')}, email: ${jsSafe((params.email as string) || '')}, contact: ${jsSafe((params.contact as string) || '')} },
        theme: { color: "#05A357" },
        handler: function(response){ post({ type: "success", ...response }); },
        modal: { ondismiss: function(){ post({ type: "dismissed" }); } }
      };
      try { new Razorpay(options).open(); } catch(e){ post({ type: "error", message: String(e) }); }
    </script>
  </body></html>`;

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'success') {
        setStatus('verifying');
        await api(`/bookings/verify-payment`, {
          method: 'POST',
          body: JSON.stringify({
            booking_id: params.booking_id,
            razorpay_order_id: msg.razorpay_order_id,
            razorpay_payment_id: msg.razorpay_payment_id,
            razorpay_signature: msg.razorpay_signature,
          }),
        });
        setStatus('done');
        router.replace({ pathname: '/ticket/[id]', params: { id: params.booking_id as string } });
      } else if (msg.type === 'dismissed') {
        router.back();
      } else if (msg.type === 'error') {
        setErr(msg.message || 'Payment error');
        setStatus('error');
      }
    } catch (e: any) {
      setErr(e.message || 'Unknown error');
      setStatus('error');
    }
  }, [params.booking_id]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.brandPrimary }} edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}><Ionicons name="close" size={22} color="#fff" /></Pressable>
        <Text style={styles.h1}>Razorpay Checkout</Text>
        <View style={{ width: 40 }} />
      </View>
      {status === 'verifying' && <View style={styles.overlay}><ActivityIndicator size="large" color="#fff" /><Text style={{ color: '#fff', marginTop: 12 }}>Verifying payment...</Text></View>}
      {err && (
        <View style={styles.overlay}>
          <Ionicons name="alert-circle" size={40} color={colors.error} />
          <Text style={{ color: '#fff', marginTop: 8 }}>{err}</Text>
          <Pressable onPress={() => router.back()} style={styles.retry}><Text style={{ color: '#fff', fontWeight: '700' }}>Go back</Text></Pressable>
        </View>
      )}
      {!err && (
        <WebView
          ref={webRef}
          source={{ html }}
          originWhitelist={["*"]}
          javaScriptEnabled
          onMessage={onMessage}
          startInLoadingState
          renderLoading={() => <ActivityIndicator style={{ marginTop: 40 }} color="#fff" />}
          style={{ flex: 1, backgroundColor: colors.brandPrimary }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  h1: { fontSize: font.lg, fontWeight: '800', color: '#fff' },
  iconBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#ffffff20', alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', top: 60, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary },
  retry: { marginTop: 16, backgroundColor: colors.brandSecondary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
});
