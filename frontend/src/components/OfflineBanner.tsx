import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetwork } from '../hooks/useNetwork';
import { useLanguageStore } from '../i18n';

export function OfflineBanner() {
  const { isOffline } = useNetwork();
  const { language } = useLanguageStore();

  if (!isOffline) return null;

  return (
    <View style={styles.container}>
      <Ionicons name="cloud-offline" size={18} color="#FEF3C7" />
      <Text style={styles.text}>
        {language === 'bg' 
          ? 'Няма връзка с интернет'
          : 'No internet connection'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#D97706',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 8,
  },
  text: {
    color: '#FEF3C7',
    fontSize: 13,
    fontWeight: '600',
  },
});
