import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '../services/api';
import { COLORS } from '../theme/colors';

// Small persistent pill showing remaining scan credits, mounted in the
// Invoices and Home headers (see the pricing/UI conversation this was built
// from) - a quiet, always-visible reminder of the balance that the
// scan-credits screen covers in full, without duplicating that screen's
// whole layout in two more places.
export function ScanCreditsBadge() {
  const router = useRouter();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getScanBalance()
      .then((balance) => { if (!cancelled) setRemaining(balance.total_remaining); })
      .catch(() => { /* silent - this is a convenience indicator, not critical path */ });
    return () => { cancelled = true; };
  }, []);

  if (remaining === null) return null;

  return (
    <TouchableOpacity
      style={[styles.badge, remaining === 0 && styles.badgeEmpty]}
      onPress={() => router.push('/scan-credits')}
      accessibilityLabel={`${remaining}`}
    >
      <Ionicons name="scan-outline" size={14} color={remaining === 0 ? COLORS.warning : COLORS.primary} />
      <Text style={[styles.text, remaining === 0 && styles.textEmpty]}>{remaining}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  badgeEmpty: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  text: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  textEmpty: {
    color: COLORS.warning,
  },
});
