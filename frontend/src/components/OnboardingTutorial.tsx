import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSegments } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n';
import { useOnboardingStore } from '../stores/onboardingStore';

// Non-intrusive, one-time product tour: auto-opens the first time a given
// user logs in (see useOnboardingStore.checkAndMaybeOpen), and stays
// reachable afterwards via a small floating "?" button rendered on every
// authenticated screen - so a user who skipped/finished it once can still
// pull it back up later if they need a refresher.
const STEPS = [
  { icon: 'sparkles', titleKey: 'tutorial.step1Title', textKey: 'tutorial.step1Text' },
  { icon: 'scan', titleKey: 'tutorial.step2Title', textKey: 'tutorial.step2Text' },
  { icon: 'cash', titleKey: 'tutorial.step3Title', textKey: 'tutorial.step3Text' },
  { icon: 'bar-chart', titleKey: 'tutorial.step4Title', textKey: 'tutorial.step4Text' },
  { icon: 'people', titleKey: 'tutorial.step5Title', textKey: 'tutorial.step5Text' },
  { icon: 'help-buoy', titleKey: 'tutorial.step6Title', textKey: 'tutorial.step6Text' },
] as const;

const HIDDEN_ON_SEGMENTS = ['login', 'forgot-password'];

export function OnboardingTutorial() {
  const { user, isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { isVisible, open, markSeen, checkAndMaybeOpen } = useOnboardingStore();
  const [step, setStep] = React.useState(0);

  useEffect(() => {
    if (isAuthenticated && user?.user_id) {
      checkAndMaybeOpen(user.user_id);
    }
  }, [isAuthenticated, user?.user_id]);

  useEffect(() => {
    if (isVisible) setStep(0);
  }, [isVisible]);

  const hideFloatingButton = !isAuthenticated || HIDDEN_ON_SEGMENTS.includes(segments[0] as string);

  const finish = () => {
    if (user?.user_id) markSeen(user.user_id);
  };

  const goNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      finish();
    }
  };

  const goBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const current = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  return (
    <>
      {!hideFloatingButton && (
        <TouchableOpacity
          style={[styles.floatingButton, { top: insets.top + 8 }]}
          onPress={open}
          accessibilityLabel={t('tutorial.helpButtonLabel')}
        >
          <Ionicons name="help" size={20} color="white" />
        </TouchableOpacity>
      )}

      <Modal visible={isVisible} animationType="fade" transparent onRequestClose={finish}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <TouchableOpacity style={styles.closeBtn} onPress={finish}>
              <Ionicons name="close" size={22} color="#64748B" />
            </TouchableOpacity>

            <View style={styles.iconCircle}>
              <Ionicons name={current.icon as any} size={32} color="#8B5CF6" />
            </View>

            <Text style={styles.title}>{t(current.titleKey)}</Text>
            <Text style={styles.text}>{t(current.textKey)}</Text>

            <View style={styles.dotsRow}>
              {STEPS.map((_, i) => (
                <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
              ))}
            </View>

            <Text style={styles.stepCounter}>
              {t('tutorial.stepCounter').replace('{current}', String(step + 1)).replace('{total}', String(STEPS.length))}
            </Text>

            <View style={styles.actions}>
              {step === 0 ? (
                <TouchableOpacity style={styles.secondaryBtn} onPress={finish}>
                  <Text style={styles.secondaryBtnText}>{t('tutorial.skip')}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.secondaryBtn} onPress={goBack}>
                  <Text style={styles.secondaryBtnText}>{t('tutorial.back')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.primaryBtn} onPress={goNext}>
                <Text style={styles.primaryBtnText}>{isLastStep ? t('tutorial.done') : t('tutorial.next')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  floatingButton: {
    position: 'absolute',
    right: 12,
    zIndex: 999,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(139, 92, 246, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 4,
    zIndex: 1,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 10,
  },
  text: {
    fontSize: 14,
    color: '#CBD5E1',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 18,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#334155',
  },
  dotActive: {
    backgroundColor: '#8B5CF6',
    width: 16,
  },
  stepCounter: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#334155',
  },
  secondaryBtnText: {
    color: '#CBD5E1',
    fontWeight: '600',
    fontSize: 14,
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#8B5CF6',
  },
  primaryBtnText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
});
