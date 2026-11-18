import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSegments, usePathname, useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n';
import { useOnboardingStore } from '../stores/onboardingStore';
import { useModulesStore } from '../stores/modulesStore';
import { api } from '../services/api';
import { COLORS } from '../theme/colors';
import { ModalBlurBackdrop } from './ModalBlurBackdrop';

// The first start (Л5): one question - "С какво работите?" - for the
// owner of a new business. The answer sets the parts of the program it
// uses and whether it is registered for VAT, so Home and the menus show
// only those from the first minute; everything stays in Account → Фирма to
// change later. No tour: each screen says what it does once, the first
// time it is opened (FirstUseHint), and an empty Home says where to start.
// A member who joins a business is asked nothing.
//
// The small floating "?" button rendered on authenticated screens is a
// separate, permanent shortcut to the Help screen.
const CHOICES = [
  { key: 'till', icon: 'cash-outline', labelKey: 'start.till', hintKey: 'start.tillHint' },
  { key: 'billing', icon: 'document-text-outline', labelKey: 'start.billing', hintKey: 'start.billingHint' },
  { key: 'team', icon: 'people-outline', labelKey: 'start.team', hintKey: 'start.teamHint' },
  { key: 'vat', icon: 'calculator-outline', labelKey: 'start.vat', hintKey: 'start.vatHint' },
] as const;

type ChoiceKey = typeof CHOICES[number]['key'];

const HIDDEN_ON_SEGMENTS = ['login', 'forgot-password', 'help'];

// Every tab-root screen (Home, Scan, Invoices, Stats, Team, Profile) already
// has a tab bar eating into the bottom, and several also place a real "add"
// FAB at bottom-right or export/logout icons in the header top-right -
// bottom-left is the one corner none of them use, so the help button lives
// there. Mirrors the tab-bar height constant from (tabs)/_layout.tsx.
const TAB_ROUTES = ['/', '/scan', '/invoices', '/stats', '/team', '/profile'];
const TAB_BAR_HEIGHT = 70;

export function OnboardingTutorial() {
  const { user, isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isVisible, markSeen, checkAndMaybeOpen } = useOnboardingStore();

  // Only the owner sets what the business uses. The question waits until
  // the business's parts have loaded, so an owner is never skipped by mistake.
  const canEditModules = useModulesStore((state) => state.canEdit);
  const modulesCompany = useModulesStore((state) => state.companyId);
  const saveModules = useModulesStore((state) => state.save);
  const modulesReady = !!user?.company_id && modulesCompany === user.company_id;

  const [chosen, setChosen] = React.useState<Record<ChoiceKey, boolean>>({ till: true, billing: false, team: false, vat: false });
  const [saving, setSaving] = React.useState(false);

  useEffect(() => {
    if (isAuthenticated && user?.user_id) {
      checkAndMaybeOpen(user.user_id);
    }
  }, [isAuthenticated, user?.user_id]);

  const finish = () => {
    if (user?.user_id) markSeen(user.user_id);
  };

  // A member who joined a business: nothing to ask.
  useEffect(() => {
    if (isVisible && modulesReady && !canEditModules) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, modulesReady, canEditModules]);

  const toggle = (key: ChoiceKey) => setChosen((prev) => ({ ...prev, [key]: !prev[key] }));

  const save = async () => {
    setSaving(true);
    try {
      await saveModules({
        till: chosen.till, billing: chosen.billing, team: chosen.team, payroll: chosen.team,
        // Not asked: off until wanted (Account → Фирма).
        assets: false, wallet: false,
      });
      await api.updateCompany({ vat_registered: chosen.vat });
    } catch {
      // Offline or a hiccup: every part stays on and the VAT question waits
      // on Home, as for a business that never answered.
    } finally {
      setSaving(false);
      finish();
    }
  };

  const hideFloatingButton = !isAuthenticated || HIDDEN_ON_SEGMENTS.includes(segments[0] as string);
  const isTabRoot = TAB_ROUTES.includes(pathname);
  const floatingBottom = insets.bottom + (isTabRoot ? TAB_BAR_HEIGHT + 12 : 16);

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

      <Modal visible={isVisible && modulesReady && canEditModules} animationType="fade" transparent onRequestClose={finish}>
        <View style={styles.overlay}>
          <ModalBlurBackdrop />
          <View style={styles.card}>
            <View style={styles.iconCircle}>
              <Ionicons name="sparkles" size={30} color={COLORS.primary} />
            </View>
            <Text style={styles.title}>{t('start.question')}</Text>
            <Text style={styles.text}>{t('start.subtitle')}</Text>

            <View style={styles.choices}>
              {CHOICES.map((choice) => {
                const on = chosen[choice.key];
                return (
                  <TouchableOpacity
                    key={choice.key}
                    style={[styles.choice, on && styles.choiceOn]}
                    onPress={() => toggle(choice.key)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    <Ionicons name={choice.icon} size={20} color={on ? COLORS.primary : COLORS.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.choiceLabel, on && styles.choiceLabelOn]}>{t(choice.labelKey)}</Text>
                      <Text style={styles.choiceHint}>{t(choice.hintKey)}</Text>
                    </View>
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? COLORS.primary : COLORS.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="white" /> : <Text style={styles.primaryBtnText}>{t('start.done')}</Text>}
            </TouchableOpacity>
            <Text style={styles.later}>{t('start.later')}</Text>
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
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 19,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 6,
  },
  text: {
    fontSize: 13,
    color: COLORS.textSubtle,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
  },
  choices: {
    alignSelf: 'stretch',
    gap: 8,
    marginBottom: 16,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  choiceOn: {
    borderColor: 'rgba(139, 92, 246, 0.6)',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
  },
  choiceLabel: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  choiceLabelOn: { color: 'white' },
  choiceHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 1 },
  primaryBtn: {
    alignSelf: 'stretch',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.primary,
  },
  primaryBtnText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  later: { color: COLORS.textMuted, fontSize: 12, marginTop: 10, textAlign: 'center' },
});
