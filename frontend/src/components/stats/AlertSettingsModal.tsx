import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Switch, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { PriceAlertSettings, PriceAlertMute } from '../../types';
import { COLORS } from '../../theme/colors';
import { parseAmount } from '../../utils/money';

// Extracted from stats.tsx's renderAlertSettingsModal (Module 1 audit
// finding #4). Data loading/mutation (loadAlertSettings, saveAlertSettings,
// unmuteItem) stay in stats.tsx, which still owns alertSettings/alertMutes
// state - this only renders the modal and reports edits back up.
type Props = {
  visible: boolean;
  onClose: () => void;
  alertSettings: PriceAlertSettings | null;
  onChangeSettings: (settings: PriceAlertSettings) => void;
  alertMutes: PriceAlertMute[];
  savingAlertSettings: boolean;
  onSave: () => void;
  onUnmute: (muteId: string) => void;
};

// A number setting typed as text: the field keeps what is typed ("2," on
// the way to "2,5", or an emptied field) and hands on the amount it reads.
// Bound to the number itself, the comma would vanish as it is typed.
function NumberSetting({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(() => String(value));
  // A value set from outside (the settings loaded again) shows; the one
  // this field just handed on leaves what is being typed as it is.
  useEffect(() => {
    setText((current) => (parseAmount(current) === value ? current : String(value)));
  }, [value]);
  return (
    <TextInput
      style={styles.alertSettingsInput}
      value={text}
      onChangeText={(v) => { setText(v); onChange(parseAmount(v)); }}
      keyboardType="decimal-pad"
      placeholderTextColor={COLORS.textMuted}
    />
  );
}

export function AlertSettingsModal({
  visible, onClose, alertSettings, onChangeSettings, alertMutes, savingAlertSettings, onSave, onUnmute,
}: Props) {
  const { t } = useTranslation();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={1}>{t('priceAlertSettings.title')}</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={28} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>

        {!alertSettings ? (
          <View style={styles.modalLoading}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <ScrollView style={styles.modalContent}>
            <View style={styles.alertSettingsRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.alertSettingsLabel}>{t('priceAlertSettings.enabled')}</Text>
                <Text style={styles.alertSettingsHint}>{t('priceAlertSettings.enabledHint')}</Text>
              </View>
              <Switch
                value={alertSettings.enabled}
                onValueChange={(v) => onChangeSettings({ ...alertSettings, enabled: v })}
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
                thumbColor={alertSettings.enabled ? 'white' : COLORS.textMuted}
              />
            </View>

            <View style={styles.alertSettingsRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.alertSettingsLabel}>{t('priceAlertSettings.alertOnDecrease')}</Text>
                <Text style={styles.alertSettingsHint}>{t('priceAlertSettings.alertOnDecreaseHint')}</Text>
              </View>
              <Switch
                value={alertSettings.alert_on_decrease}
                onValueChange={(v) => onChangeSettings({ ...alertSettings, alert_on_decrease: v })}
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
                thumbColor={alertSettings.alert_on_decrease ? 'white' : COLORS.textMuted}
              />
            </View>

            <View style={styles.alertSettingsField}>
              <Text style={styles.alertSettingsLabel}>{t('priceAlertSettings.threshold')}</Text>
              <Text style={styles.alertSettingsHint}>{t('priceAlertSettings.thresholdHint')}</Text>
              <NumberSetting
                value={alertSettings.threshold_percent}
                onChange={(n) => onChangeSettings({ ...alertSettings, threshold_percent: n })}
              />
            </View>

            <View style={styles.alertSettingsField}>
              <Text style={styles.alertSettingsLabel}>{t('priceAlertSettings.minMonthlyImpact')}</Text>
              <Text style={styles.alertSettingsHint}>{t('priceAlertSettings.minMonthlyImpactHint')}</Text>
              <NumberSetting
                value={alertSettings.min_monthly_impact ?? 10}
                onChange={(n) => onChangeSettings({ ...alertSettings, min_monthly_impact: n })}
              />
            </View>

            <TouchableOpacity
              style={[styles.alertSettingsSaveBtn, savingAlertSettings && { opacity: 0.6 }]}
              onPress={onSave}
              disabled={savingAlertSettings}
            >
              <Text style={styles.alertSettingsSaveBtnText}>
                {savingAlertSettings ? t('common.saving') : t('common.save')}
              </Text>
            </TouchableOpacity>

            <View style={styles.alertSettingsDivider} />

            <Text style={styles.alertSettingsLabel}>{t('priceAlertSettings.mutedTitle')}</Text>
            <Text style={styles.alertSettingsHint}>{t('priceAlertSettings.mutedHint')}</Text>
            {alertMutes.length === 0 ? (
              <Text style={styles.alertsEmptyText}>{t('priceAlertSettings.mutedEmpty')}</Text>
            ) : alertMutes.map((mute) => (
              <View key={mute.id} style={styles.mutedRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertItemName} numberOfLines={1}>{mute.item_name}</Text>
                  <Text style={styles.alertSupplier} numberOfLines={1}>{mute.supplier}</Text>
                </View>
                <TouchableOpacity onPress={() => onUnmute(mute.id)} style={styles.mutedUnmuteBtn}>
                  <Text style={styles.mutedUnmuteBtnText}>{t('priceAlertSettings.unmute')}</Text>
                </TouchableOpacity>
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    flex: 1,
    textAlign: 'center',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  modalLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertSettingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  alertSettingsField: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  alertSettingsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  alertSettingsHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  alertSettingsInput: {
    marginTop: 10,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: 'white',
    fontSize: 15,
  },
  alertSettingsSaveBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  alertSettingsSaveBtnText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 15,
  },
  alertSettingsDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 20,
  },
  alertsEmptyText: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
  },
  alertItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  alertSupplier: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  mutedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  mutedUnmuteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.background,
  },
  mutedUnmuteBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
});
