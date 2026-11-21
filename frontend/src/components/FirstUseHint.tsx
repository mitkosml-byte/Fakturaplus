import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n';
import { COLORS } from '../theme/colors';

type Props = { id: string; icon: keyof typeof Ionicons.glyphMap; text: string };

// One line on what a screen does, the first time this person opens it
// (Л5: the tour became these) - gone for good once closed.
export function FirstUseHint({ id, icon, text }: Props) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const key = user?.user_id ? `hint_seen_${user.user_id}_${id}` : null;

  useEffect(() => {
    if (!key) return;
    let alive = true;
    AsyncStorage.getItem(key)
      .then((seen) => { if (alive && !seen) setShown(true); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [key]);

  if (!shown) return null;

  const close = () => {
    setShown(false);
    if (key) AsyncStorage.setItem(key, '1').catch(() => undefined);
  };

  return (
    <View style={styles.hint}>
      <Ionicons name={icon} size={18} color={COLORS.primary} />
      <Text style={styles.text}>{text}</Text>
      <TouchableOpacity onPress={close} hitSlop={10} accessibilityLabel={t('common.close')}>
        <Ionicons name="close" size={18} color={COLORS.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  text: { flex: 1, color: COLORS.textLight, fontSize: 13, lineHeight: 18 },
});
