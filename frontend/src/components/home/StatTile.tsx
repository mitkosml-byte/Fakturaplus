import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';

// One of Home's main numbers, in the greeting card's manner: the value large
// and what it is under it, on a surface lit faintly in its own colour from
// the top left, with a thin border of the same colour - the invoices blue,
// the till violet, the tips amber, the profit green (red at a loss).

type Props = {
  accent: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  // The value itself (a count-up or a locked value).
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  // Something drawn over the tile, like the profit's celebration glow.
  decoration?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function StatTile({ accent, icon, label, children, onPress, disabled, decoration, style }: Props) {
  const body = (
    <LinearGradient
      colors={[`${accent}38`, `${accent}0F`, COLORS.surface]}
      locations={[0, 0.5, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.tile, { borderColor: `${accent}55` }]}
    >
      {decoration}
      {children}
      <View style={styles.labelRow}>
        <Ionicons name={icon} size={13} color={accent} />
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
      </View>
    </LinearGradient>
  );
  if (onPress) {
    return (
      <TouchableOpacity style={[styles.wrap, style]} onPress={onPress} disabled={disabled} accessibilityRole="button">
        {body}
      </TouchableOpacity>
    );
  }
  return <View style={[styles.wrap, style]}>{body}</View>;
}

const styles = StyleSheet.create({
  wrap: {
    width: '47%',
    flexGrow: 1,
  },
  tile: {
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
    maxWidth: '100%',
  },
  label: {
    fontSize: 12,
    color: COLORS.textSecondary,
    flexShrink: 1,
  },
});
