// Web replacement for react-native-modal-datetime-picker, whose underlying
// @react-native-community/datetimepicker renders nothing at all on web
// (it's a native-only library - the web fallback literally returns null).
// Same prop surface as the native component so every call site across the
// app can import this one drop-in instead, unchanged.
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format, parse } from 'date-fns';

interface AppDateTimePickerProps {
  isVisible: boolean;
  mode?: 'date' | 'time' | 'datetime';
  date?: Date;
  minimumDate?: Date;
  maximumDate?: Date;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
  confirmTextIOS?: string;
  cancelTextIOS?: string;
  locale?: string;
}

const DATE_FORMAT = 'yyyy-MM-dd';
const TIME_FORMAT = 'HH:mm';

export default function AppDateTimePicker({
  isVisible,
  mode = 'date',
  date,
  minimumDate,
  maximumDate,
  onConfirm,
  onCancel,
  confirmTextIOS,
  cancelTextIOS,
}: AppDateTimePickerProps) {
  const isTime = mode === 'time';
  const fieldFormat = isTime ? TIME_FORMAT : DATE_FORMAT;
  const [value, setValue] = useState(() => format(date || new Date(), fieldFormat));

  // Re-sync the field to whatever date this picker was opened with, each
  // time it's (re)opened - the input otherwise keeps whatever was typed
  // the previous time this same modal instance was shown.
  useEffect(() => {
    if (isVisible) setValue(format(date || new Date(), fieldFormat));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  if (!isVisible) return null;

  const handleConfirm = () => {
    if (!value) return;
    const result = isTime
      ? parse(value, TIME_FORMAT, date || new Date())
      : parse(value, DATE_FORMAT, new Date());
    if (isNaN(result.getTime())) return;
    onConfirm(result);
  };

  return (
    <Modal visible={isVisible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {React.createElement('input', {
            type: isTime ? 'time' : 'date',
            value,
            min: !isTime && minimumDate ? format(minimumDate, DATE_FORMAT) : undefined,
            max: !isTime && maximumDate ? format(maximumDate, DATE_FORMAT) : undefined,
            onChange: (e: any) => setValue(e.target.value),
            autoFocus: true,
            style: webInputStyle,
          })}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionButton} onPress={onCancel}>
              <Text style={styles.cancelText}>{cancelTextIOS || 'Отказ'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, styles.confirmButton]} onPress={handleConfirm}>
              <Text style={styles.confirmText}>{confirmTextIOS || 'Избери'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const webInputStyle: React.CSSProperties = {
  backgroundColor: '#0F172A',
  color: 'white',
  border: '1px solid #334155',
  borderRadius: 10,
  padding: '12px 14px',
  fontSize: 16,
  width: '100%',
  boxSizing: 'border-box',
  colorScheme: 'dark',
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 320,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  actionButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  confirmButton: {
    backgroundColor: '#8B5CF6',
  },
  cancelText: {
    color: '#94A3B8',
    fontWeight: '600',
  },
  confirmText: {
    color: 'white',
    fontWeight: '600',
  },
});
