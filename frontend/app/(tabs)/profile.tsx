import { View, Text, StyleSheet, ScrollView, Pressable, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/src/auth';
import { Card } from '@/src/ui';
import { fileUrl } from '@/src/api';
import { colors, spacing, font, radius } from '@/src/theme';

export default function Profile() {
  const { user, logout, switchRole } = useAuth();
  const isAdmin = user?.is_admin;

  const roles: { key: 'passenger' | 'driver' | 'admin'; label: string; icon: any }[] = [
    { key: 'passenger', label: 'Passenger', icon: 'person-outline' },
    { key: 'driver', label: 'Driver', icon: 'car-outline' },
    ...(isAdmin ? [{ key: 'admin' as const, label: 'Admin', icon: 'shield-checkmark-outline' as const }] : []),
  ];

  const rows = [
    { icon: 'car-sport-outline', label: 'My Vehicles', onPress: () => router.push('/driver/register'), show: user?.active_role === 'driver' },
    { icon: 'shield-checkmark-outline', label: 'Admin Dashboard', onPress: () => router.push('/admin'), show: isAdmin && user?.active_role === 'admin' },
    { icon: 'call-outline', label: `Emergency: ${user?.emergency_contact || 'Add contact'}`, onPress: () => router.push('/onboarding'), show: true },
    { icon: 'settings-outline', label: 'Edit Profile', onPress: () => router.push('/onboarding'), show: true },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            {user?.picture ? (
              <Image source={{ uri: fileUrl(user.picture) }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Ionicons name="person" size={28} color="#fff" />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: font.xl, fontWeight: '800', color: colors.onSurface }}>{user?.name}</Text>
              <Text style={{ color: colors.muted, marginTop: 2 }}>{user?.email || user?.phone}</Text>
            </View>
          </View>
        </Card>

        <Text style={styles.section}>Switch Role</Text>
        <Card style={{ padding: spacing.sm, flexDirection: 'row', gap: spacing.sm }}>
          {roles.map(r => {
            const active = user?.active_role === r.key;
            return (
              <Pressable
                key={r.key}
                testID={`role-${r.key}`}
                onPress={() => switchRole(r.key)}
                style={[styles.roleBtn, active && styles.roleBtnActive]}
              >
                <Ionicons name={r.icon} size={18} color={active ? '#fff' : colors.onSurface} />
                <Text style={[styles.roleTxt, active && { color: '#fff' }]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </Card>

        <Text style={styles.section}>Settings</Text>
        {rows.filter(r => r.show).map((r, i) => (
          <Pressable key={i} onPress={r.onPress}>
            <Card style={{ padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={styles.iconBox}>
                <Ionicons name={r.icon as any} size={20} color={colors.brandPrimary} />
              </View>
              <Text style={{ flex: 1, color: colors.onSurface, fontWeight: '600' }}>{r.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Card>
          </Pressable>
        ))}

        <Pressable testID="profile-logout-button" onPress={logout}>
          <Card style={{ padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.error, fontWeight: '700' }}>Logout</Text>
          </Card>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.surfaceTertiary },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary },
  section: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface, marginTop: spacing.sm },
  roleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  roleBtnActive: { backgroundColor: colors.brandPrimary },
  roleTxt: { fontWeight: '700', color: colors.onSurface, fontSize: font.sm },
  iconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
});
