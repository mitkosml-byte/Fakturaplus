import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../i18n';
import { COLORS } from '../theme/colors';
import { Haptics } from '../utils/haptics';
import { useLocationChoice } from '../stores/locationsStore';

type Props = {
  value: string | null;
  onChange: (locationId: string | null) => void;
  label?: string;
  // What "no location" means on this form (the whole business, shared...).
  noneLabel?: string;
  hint?: string;
};

// Which location a record is for (Н11) - shown only in a business that has
// locations. A closed location still shows on a record already filed under it.
export function LocationPicker({ value, onChange, label, noneLabel, hint }: Props) {
  const { t } = useTranslation();
  const { all, active } = useLocationChoice();
  const current = value ? all.find((l) => l.id === value) : undefined;
  const options = current && !current.is_active ? [...active, current] : active;
  if (options.length === 0) return null;

  const pick = (id: string | null) => {
    if (id === value) return;
    Haptics.selection();
    onChange(id);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label ?? t('locations.pick')}</Text>
      <View style={styles.chips}>
        {options.map((location) => {
          const selected = value === location.id;
          return (
            <TouchableOpacity
              key={location.id}
              style={[styles.chip, selected && styles.chipActive]}
              onPress={() => pick(location.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Ionicons name="storefront-outline" size={13} color={selected ? 'white' : COLORS.textSecondary} />
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>{location.name}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          style={[styles.chip, value === null && styles.chipActive]}
          onPress={() => pick(null)}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === null }}
        >
          <Text style={[styles.chipText, value === null && styles.chipTextActive]}>{noneLabel ?? t('locations.none')}</Text>
        </TouchableOpacity>
      </View>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textSecondary, fontSize: 13 },
  chipTextActive: { color: 'white', fontWeight: '600' },
  hint: { color: COLORS.textMuted, fontSize: 11, marginTop: 6, lineHeight: 15 },
});
