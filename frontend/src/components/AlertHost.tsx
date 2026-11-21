import React, { useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AlertButton, useAlertQueue } from '../utils/alert';
import { COLORS } from '../theme/colors';

// The web's dialog for Alert.alert (src/utils/alert.ts): the title, the
// message and every answer the question has - "Not yet" and "Already
// paid" both, "Add a shift" and "Delete the leave" and "Cancel" all three.
// Two answers sit side by side; more stack, the cancel one last. Escape or
// a tap beside the dialog is the cancel answer, when there is one.
export function AlertHost() {
  const dialog = useAlertQueue((state) => state.queue[0]);
  const shift = useAlertQueue((state) => state.shift);

  const cancel = dialog?.buttons.find((b) => b.style === 'cancel');
  const answer = (button?: AlertButton) => {
    shift();
    button?.onPress?.();
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || !dialog || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && cancel) answer(cancel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog?.id]);

  if (Platform.OS !== 'web' || !dialog) return null;

  const others = dialog.buttons.filter((b) => b !== cancel);
  const side = dialog.buttons.length <= 2;
  const ordered = side ? [...(cancel ? [cancel] : []), ...others] : [...others, ...(cancel ? [cancel] : [])];

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => cancel && answer(cancel)}>
      <Pressable style={styles.overlay} onPress={() => cancel && answer(cancel)}>
        <Pressable style={styles.card} onPress={() => undefined} accessibilityRole="alert">
          <Text style={styles.title}>{dialog.title}</Text>
          {!!dialog.message && <Text style={styles.message}>{dialog.message}</Text>}
          <View style={[styles.buttons, side ? styles.buttonsRow : styles.buttonsColumn]}>
            {ordered.map((button, index) => {
              const isCancel = button === cancel;
              const isDestructive = button.style === 'destructive';
              const isMain = !isCancel && !isDestructive && button === others[others.length - 1];
              return (
                <TouchableOpacity
                  key={`${dialog.id}-${index}`}
                  style={[
                    styles.button,
                    side && styles.buttonInRow,
                    isMain && styles.buttonMain,
                    isDestructive && styles.buttonDestructive,
                  ]}
                  onPress={() => answer(button)}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.buttonText,
                      isCancel && styles.buttonTextCancel,
                      isMain && styles.buttonTextMain,
                      isDestructive && styles.buttonTextDestructive,
                    ]}
                  >
                    {button.text || 'OK'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  title: { color: 'white', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  message: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  buttons: { marginTop: 16, gap: 8 },
  buttonsRow: { flexDirection: 'row' },
  buttonsColumn: { flexDirection: 'column' },
  button: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  buttonInRow: { flex: 1 },
  buttonMain: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  buttonDestructive: { borderColor: COLORS.danger },
  buttonText: { color: 'white', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  buttonTextCancel: { color: COLORS.textSecondary },
  buttonTextMain: { color: 'white' },
  buttonTextDestructive: { color: COLORS.danger },
});
