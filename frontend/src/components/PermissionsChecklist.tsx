import React from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { useLanguageStore } from '../i18n';
import { ROLE_CONFIGURABLE_PERMISSIONS, ConfigurableRole, getPermissionLabel } from '../utils/permissions';
import { COLORS } from '../theme/colors';

interface PermissionsChecklistProps {
  role: ConfigurableRole;
  selected: string[];
  onToggle: (permission: string) => void;
}

// The owner's per-role tick-menu: only ever shows the permissions that
// role is allowed to hold (ROLE_CONFIGURABLE_PERMISSIONS), so an
// accountant's list stays short and never shows organizational or
// operational options that don't apply to that role.
export function PermissionsChecklist({ role, selected, onToggle }: PermissionsChecklistProps) {
  const { language } = useLanguageStore();
  const options = ROLE_CONFIGURABLE_PERMISSIONS[role] || [];

  return (
    <View style={styles.container}>
      {options.map((permission) => (
        <View key={permission} style={styles.row}>
          <Text style={styles.label}>{getPermissionLabel(permission, language)}</Text>
          <Switch
            value={selected.includes(permission)}
            onValueChange={() => onToggle(permission)}
            trackColor={{ false: COLORS.border, true: COLORS.primary }}
            thumbColor={selected.includes(permission) ? 'white' : COLORS.textMuted}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surface,
  },
  label: {
    fontSize: 14,
    color: COLORS.textLight,
    flex: 1,
    marginRight: 12,
  },
});
