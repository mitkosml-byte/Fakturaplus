import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../theme/colors';
import type { DescriptionSuggestion } from '../utils/expenseSuggestions';

type Props = {
  suggestions: DescriptionSuggestion[];
  onPick: (s: DescriptionSuggestion) => void;
  label: string;
};

// A row of tappable "fill this in for me" chips built from past entries -
// see src/utils/expenseSuggestions.ts for the ranking. Renders nothing
// when there's no history yet, so it never shows an empty placeholder row.
export function SuggestionChips({ suggestions, onPick, label }: Props) {
  if (suggestions.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {suggestions.map((s) => (
          <TouchableOpacity key={s.description} style={styles.chip} onPress={() => onPick(s)}>
            <Text style={styles.chipText} numberOfLines={1}>{s.description}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: 11, color: COLORS.textMuted, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxWidth: 170,
  },
  chipText: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '600' },
});
