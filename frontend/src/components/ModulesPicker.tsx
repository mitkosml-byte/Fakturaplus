import React, { useState } from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../i18n';
import { Alert } from '../utils/alert';
import { MODULE_ORDER, useModulesStore } from '../stores/modulesStore';
import type { BusinessModule } from '../types';
import { COLORS } from '../theme/colors';

const MODULE_ICON: Record<BusinessModule, keyof typeof Ionicons.glyphMap> = {
  till: 'cash-outline',
  billing: 'document-text-outline',
  team: 'calendar-outline',
  payroll: 'people-outline',
  assets: 'cube-outline',
  wallet: 'person-circle-outline',
};

// "Какво ползвам": the parts of the program the business uses, switched
// on and off by the owner. A part switched off leaves the menus, Home and
// the signals - what was entered in it stays and comes back with it.
export function ModulesPicker({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const modules = useModulesStore((state) => state.modules);
  const save = useModulesStore((state) => state.save);
  const [saving, setSaving] = useState<BusinessModule | null>(null);

  const toggle = async (module: BusinessModule, on: boolean) => {
    setSaving(module);
    try {
      await save({ [module]: on });
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <View>
      {MODULE_ORDER.map((module) => (
        <View key={module} style={[styles.row, compact && styles.rowCompact]}>
          <Ionicons name={MODULE_ICON[module]} size={compact ? 20 : 22} color={modules[module] ? COLORS.primary : COLORS.textMuted} />
          <View style={styles.text}>
            <Text style={[styles.title, !modules[module] && styles.titleOff]}>{t(`modules.${module}`)}</Text>
            {!compact && <Text style={styles.hint}>{t(`modules.${module}Hint`)}</Text>}
          </View>
          <Switch
            value={modules[module]}
            onValueChange={(on) => toggle(module, on)}
            disabled={saving !== null}
            accessibilityLabel={t(`modules.${module}`)}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rowCompact: { paddingVertical: 6 },
  text: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600', color: 'white' },
  titleOff: { color: COLORS.textMuted },
  hint: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2, lineHeight: 16 },
});
