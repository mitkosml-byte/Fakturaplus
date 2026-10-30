import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { CHART_PALETTE } from '../theme/colors';

// Single source of truth for "show this person's identity" across the
// app (profile, team list, chat, calendar, audit log, invoices' "scanned
// by") - previously each screen hand-rolled its own circle with a
// different size and a different (sometimes broken - users-management.tsx
// never actually rendered the real photo) fallback. Falls back to a
// colored initials circle, not a generic icon, so a teammate without a
// photo yet is still visually distinguishable from every other teammate.
type Props = {
  uri?: string | null;
  name?: string;
  size?: number;
};

// Deterministic, not random - the same person gets the same color on
// every screen and every render, without storing a color anywhere.
function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CHART_PALETTE[hash % CHART_PALETTE.length];
}

export function Avatar({ uri, name, size = 40 }: Props) {
  const dimension = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return <Image source={{ uri }} style={[styles.image, dimension]} />;
  }

  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[styles.placeholder, dimension, { backgroundColor: colorForName(name || '?') }]}>
      <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: 'white',
    fontWeight: '700',
  },
});
