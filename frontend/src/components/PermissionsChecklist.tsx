import React from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { useLanguageStore } from '../i18n';
import { ROLE_CONFIGURABLE_PERMISSIONS, ConfigurableRole, getPermissionLabel } from '../utils/permissions';

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
            trackColor={{ false: '#334155', true: '#8B5CF6' }}
            thumbColor={selected.includes(permission) ? 'white' : '#64748B'}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  label: {
    fontSize: 14,
    color: '#E2E8F0',
    flex: 1,
    marginRight: 12,
  },
});
