import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '../services/api';
import { useTranslation } from '../i18n';
import { COLORS } from '../theme/colors';

// Long, explicitly-labeled entry point to the scan-credits purchase screen,
// mounted on the Scan screen itself - unlike ScanCreditsBadge (a quiet
// always-visible indicator in the Home/Invoices headers), this is meant to
// be impossible to miss exactly where running low on credits actually
// blocks the user from doing anything.
export function ScanCreditsReloadButton() {
  const router = useRouter();
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getScanBalance()
      .then((balance) => { if (!cancelled) setRemaining(balance.total_remaining); })
      .catch(() => { /* non-critical - button still works without the count */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <TouchableOpacity style={styles.button} onPress={() => router.push('/scan-credits')}>
      <Ionicons name="flash" size={18} color={COLORS.teal} />
      <Text style={styles.text} numberOfLines={1}>
        {remaining !== null
          ? t('scanCredits.reloadButtonWithCount').replace('{count}', String(remaining))
          : t('scanCredits.reloadButton')}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={COLORS.teal} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(20, 184, 166, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(20, 184, 166, 0.35)',
    marginBottom: 16,
  },
  text: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.teal,
    flexShrink: 1,
    textAlign: 'center',
  },
});
