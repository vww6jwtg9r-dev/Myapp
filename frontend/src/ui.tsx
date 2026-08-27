import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { colors, radius, spacing, shadow, font } from './theme';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
}
export function Button({ title, onPress, variant = 'primary', disabled, loading, testID, style, textStyle, icon }: ButtonProps) {
  const bg = variant === 'primary' ? colors.brandSecondary
    : variant === 'secondary' ? colors.brandPrimary
    : variant === 'outline' ? 'transparent'
    : 'transparent';
  const color = variant === 'outline' || variant === 'ghost' ? colors.brandPrimary : colors.onBrandPrimary;
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'outline' && { borderWidth: 1, borderColor: colors.borderStrong },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={color} /> : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {icon}
          <Text style={[{ color, fontWeight: '700', fontSize: font.lg }, textStyle]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Badge({ text, color = colors.brandSecondary, bg }: { text: string; color?: string; bg?: string }) {
  return (
    <View style={{
      paddingHorizontal: spacing.sm, paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: bg || `${color}22`,
      alignSelf: 'flex-start',
    }}>
      <Text style={{ color, fontSize: font.sm, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
      <Text style={{ fontSize: font.xl, fontWeight: '700', color: colors.onSurface, marginBottom: spacing.sm }}>{title}</Text>
      {subtitle && <Text style={{ color: colors.muted, textAlign: 'center' }}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  btn: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
});
