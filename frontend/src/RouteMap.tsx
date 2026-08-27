import React, { useMemo } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, radius } from './theme';

interface Props {
  from: { lat: number; lon: number; label: string };
  to: { lat: number; lon: number; label: string };
  height?: number;
}

// SEC-005: escape user strings before interpolating into <script>
function jsSafe(v: string | number): string {
  return JSON.stringify(String(v)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

// OpenStreetMap tiles + Leaflet in an isolated HTML doc so it works in Expo Go on iOS + Android.
export function RouteMap({ from, to, height = 220 }: Props) {
  const html = useMemo(() => `<!doctype html><html><head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
    <style>html,body,#m{margin:0;padding:0;height:100%;width:100%;background:#e6e9ee}</style>
  </head><body>
    <div id="m"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      const A = [${Number(from.lat)}, ${Number(from.lon)}];
      const B = [${Number(to.lat)}, ${Number(to.lon)}];
      const map = L.map('m', { zoomControl: false, attributionControl: false }).setView(A, 6);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
      const mkIcon = (color, label) => L.divIcon({
        className: '',
        html: '<div style="background:'+color+';color:#fff;padding:4px 8px;border-radius:10px;font-family:system-ui;font-weight:700;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,.25)">'+label+'</div>',
        iconSize: [40, 24], iconAnchor: [20, 12],
      });
      L.marker(A, { icon: mkIcon('#0B192C', 'A') }).addTo(map).bindPopup(${jsSafe(from.label)});
      L.marker(B, { icon: mkIcon('#05A357', 'B') }).addTo(map).bindPopup(${jsSafe(to.label)});
      L.polyline([A, B], { color: '#05A357', weight: 4, dashArray: '6,8' }).addTo(map);
      map.fitBounds([A, B], { padding: [30, 30] });
    </script>
  </body></html>`, [from, to]);

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        source={{ html }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        renderLoading={() => <ActivityIndicator style={styles.loader} color={colors.brandSecondary} />}
        style={styles.web}
        scrollEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceSecondary },
  web: { flex: 1, backgroundColor: 'transparent' },
  loader: { position: 'absolute', top: '50%', left: '50%' },
});
