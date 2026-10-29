import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSegments, usePathname, useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n';
import { useOnboardingStore } from '../stores/onboardingStore';
import { COLORS } from '../theme/colors';
import { ModalBlurBackdrop } from './ModalBlurBackdrop';

// Non-intrusive, one-time product tour: auto-opens the first time a given
// user logs in (see useOnboardingStore.checkAndMaybeOpen). The small floating
// "?" button rendered on every authenticated screen is a separate, permanent
// shortcut to the Help screen - not a way to replay this tour.
const STEPS = [
  { icon: 'sparkles', titleKey: 'tutorial.step1Title', textKey: 'tutorial.step1Text' },
  { icon: 'scan', titleKey: 'tutorial.step2Title', textKey: 'tutorial.step2Text' },
  { icon: 'cash', titleKey: 'tutorial.step3Title', textKey: 'tutorial.step3Text' },
  { icon: 'bar-chart', titleKey: 'tutorial.step4Title', textKey: 'tutorial.step4Text' },
  { icon: 'people', titleKey: 'tutorial.step5Title', textKey: 'tutorial.step5Text' },
  { icon: 'help-buoy', titleKey: 'tutorial.step6Title', textKey: 'tutorial.step6Text' },
] as const;

// Module 3 audit finding: the same 6-step tour ran for every business in
// the same fixed order, even though which feature matters most varies a
// lot (a restaurant cares about daily revenue entry first, a craftsman
// about scanning supplier invoices first). Per the audit's recommended
// fix, this stays a SINGLE tour - one branch question up front reorders
// which 2-3 of the middle, business-relevant steps (scan / revenue-entry
// / stats) lead, rather than building a separate tour per business type.
// The intro (sparkles, index 0) always opens and the permanent help
// reminder (help-buoy, index 5) always closes.
const BUSINESS_TYPES = [
  { key: 'retail', icon: 'storefront', labelKey: 'tutorial.businessTypeRetail' },
  { key: 'food', icon: 'restaurant', labelKey: 'tutorial.businessTypeFood' },
  { key: 'craftsman', icon: 'construct', labelKey: 'tutorial.businessTypeCraftsman' },
  { key: 'other', icon: 'ellipsis-horizontal', labelKey: 'tutorial.businessTypeOther' },
] as const;

const STEP_ORDER_BY_BUSINESS_TYPE: Record<string, number[]> = {
  retail: [1, 2, 3, 4],
  food: [2, 1, 3, 4],
  craftsman: [1, 3, 2, 4],
  other: [1, 2, 3, 4],
};

function buildSteps(businessType: string | null) {
  const middleOrder = STEP_ORDER_BY_BUSINESS_TYPE[businessType ?? 'other'] || [1, 2, 3, 4];
  return [STEPS[0], ...middleOrder.map((i) => STEPS[i]), STEPS[5]];
}

const HIDDEN_ON_SEGMENTS = ['login', 'forgot-password', 'help'];

// Every tab-root screen (Home, Scan, Invoices, Stats, Profile) already has a
// tab bar eating into the bottom, and several also place a real "add" FAB at
// bottom-right (employee-absences.tsx) or export/logout icons in the header
// top-right (stats/invoices/profile) - bottom-left is the one corner none of
// them use, so the help button lives there instead of fighting each screen's
// own layout. Mirrors the tab-bar height constant from (tabs)/_layout.tsx.
const TAB_ROUTES = ['/', '/scan', '/invoices', '/stats', '/profile'];
const TAB_BAR_HEIGHT = 70;

export function OnboardingTutorial() {
  const { user, isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isVisible, markSeen, checkAndMaybeOpen } = useOnboardingStore();
  const [step, setStep] = React.useState(0);
  const [businessType, setBusinessType] = React.useState<string | null>(null);
  const [branchAnswered, setBranchAnswered] = React.useState(false);

  useEffect(() => {
    if (isAuthenticated && user?.user_id) {
      checkAndMaybeOpen(user.user_id);
    }
  }, [isAuthenticated, user?.user_id]);

  useEffect(() => {
    if (isVisible) {
      setStep(0);
      setBusinessType(null);
      setBranchAnswered(false);
    }
  }, [isVisible]);

  const orderedSteps = React.useMemo(() => buildSteps(businessType), [businessType]);

  const chooseBusinessType = (type: string | null) => {
    setBusinessType(type);
    setBranchAnswered(true);
  };

  const hideFloatingButton = !isAuthenticated || HIDDEN_ON_SEGMENTS.includes(segments[0] as string);
  const isTabRoot = TAB_ROUTES.includes(pathname);
  const floatingBottom = insets.bottom + (isTabRoot ? TAB_BAR_HEIGHT + 12 : 16);

  const finish = () => {
    if (user?.user_id) markSeen(user.user_id);
  };

  const goNext = () => {
    if (step < orderedSteps.length - 1) {
      setStep(step + 1);
    } else {
      finish();
    }
  };

  const goBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const current = orderedSteps[step];
  const isLastStep = step === orderedSteps.length - 1;

  return (
    <>
      {!hideFloatingButton && (
        <TouchableOpacity
          style={[styles.floatingButton, { bottom: floatingBottom }]}
          onPress={() => router.push('/help')}
          accessibilityLabel={t('tutorial.helpButtonLabel')}
        >
          <Ionicons name="help" size={20} color="white" />
        </TouchableOpacity>
      )}

      <Modal visible={isVisible} animationType="fade" transparent onRequestClose={finish}>
        <View style={styles.overlay}>
          <ModalBlurBackdrop />
          <View style={styles.card}>
            <TouchableOpacity style={styles.closeBtn} onPress={finish}>
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>

            {!branchAnswered ? (
              <>
                <View style={styles.iconCircle}>
                  <Ionicons name="compass" size={32} color={COLORS.primary} />
                </View>

                <Text style={styles.title}>{t('tutorial.businessTypeQuestion')}</Text>
                <Text style={styles.text}>{t('tutorial.businessTypeSubtitle')}</Text>

                <View style={styles.businessTypeGrid}>
                  {BUSINESS_TYPES.map((bt) => (
                    <TouchableOpacity
                      key={bt.key}
                      style={styles.businessTypeOption}
                      onPress={() => chooseBusinessType(bt.key)}
                    >
                      <Ionicons name={bt.icon as any} size={22} color={COLORS.primary} />
                      <Text style={styles.businessTypeOptionText}>{t(bt.labelKey)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity style={styles.secondaryBtn} onPress={() => chooseBusinessType(null)}>
                  <Text style={styles.secondaryBtnText}>{t('tutorial.skip')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.iconCircle}>
                  <Ionicons name={current.icon as any} size={32} color={COLORS.primary} />
                </View>

                <Text style={styles.title}>{t(current.titleKey)}</Text>
                <Text style={styles.text}>{t(current.textKey)}</Text>

                <View style={styles.dotsRow}>
                  {orderedSteps.map((_, i) => (
                    <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
                  ))}
                </View>

                <Text style={styles.stepCounter}>
                  {t('tutorial.stepCounter').replace('{current}', String(step + 1)).replace('{total}', String(orderedSteps.length))}
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
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  floatingButton: {
    position: 'absolute',
    left: 16,
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
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: COLORS.surface,
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
    color: COLORS.textSubtle,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 18,
  },
  businessTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    width: '100%',
    marginBottom: 16,
  },
  businessTypeOption: {
    flexBasis: '47%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
  businessTypeOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
    textAlign: 'center',
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
    backgroundColor: COLORS.border,
  },
  dotActive: {
    backgroundColor: COLORS.primary,
    width: 16,
  },
  stepCounter: {
    fontSize: 11,
    color: COLORS.textMuted,
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
    backgroundColor: COLORS.border,
  },
  secondaryBtnText: {
    color: COLORS.textSubtle,
    fontWeight: '600',
    fontSize: 14,
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.primary,
  },
  primaryBtnText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
});
