import React from 'react';
import { TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from '../utils/alert';
import { useTranslation } from '../i18n';
import { COLORS } from '../theme/colors';

// Explanations behind an "i" (Л10): a card says its number and one line;
// how it is worked out and its caveats open on a tap, in the app's own
// dialog. Nothing to show - no button.
export function InfoButton({ title, lines, style }: { title: string; lines: string[]; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const text = lines.filter(Boolean).join('\n\n');
  if (!text) return null;
  return (
    <TouchableOpacity
      onPress={() => Alert.alert(title, text)}
      hitSlop={10}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={t('common.howItWorks')}
    >
      <Ionicons name="information-circle-outline" size={20} color={COLORS.textMuted} />
    </TouchableOpacity>
  );
}
