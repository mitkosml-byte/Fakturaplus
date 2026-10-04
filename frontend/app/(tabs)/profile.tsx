import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ImageBackground,
  RefreshControl,
  Modal,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { Alert } from '../../src/utils/alert';
import { Toast } from '../../src/utils/toast';
import { useAuth } from '../../src/contexts/AuthContext';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation, useLanguageStore, Language } from '../../src/i18n';
import { api } from '../../src/services/api';
import { Company, CompanyMembership } from '../../src/types';
import { getRoleName as sharedGetRoleName, getRoleColor } from '../../src/utils/roles';
import { COLORS } from '../../src/theme/colors';
import { DURATION, EASING } from '../../src/theme/motion';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageStore();
  const { user, logout, refreshUser, hasPermission, isOwner } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [memberships, setMemberships] = useState<CompanyMembership[]>([]);
  const [showSwitcherModal, setShowSwitcherModal] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [showNewCompanyModal, setShowNewCompanyModal] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyEik, setNewCompanyEik] = useState('');
  const [creatingCompany, setCreatingCompany] = useState(false);

  // Profile IA: 20 flat rows regrouped into 5 categories (Motion Design
  // Audit's documented proposal) behind a horizontal chip selector, the
  // same pattern Statistics uses for its own tabs. A category is only
  // ever shown if it has at least one item this user's role can see, so
  // a narrower permission set means fewer categories, not emptier ones.
  type CategoryKey = 'company' | 'accounting' | 'security' | 'settings' | 'support';
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(null);
  const [displayedCategory, setDisplayedCategory] = useState<CategoryKey | null>(null);
  // Measured on demand via measureLayout rather than cached from onLayout:
  // react-native-web's onLayout is backed by a ResizeObserver, which only
  // fires on a SIZE change - a chip that merely shifts x position because a
  // sibling was inserted/removed before it (exactly what happens here, since
  // hasPermission depends on `user` and can load a beat after first paint,
  // changing which categories - and therefore which chips - exist) never
  // refires onLayout, leaving a stale cached x behind. measureLayout queries
  // the real current DOM position every time instead, so it can't go stale.
  const rowRef = useRef<View>(null);
  const chipRefs = useRef<Partial<Record<CategoryKey, any>>>({});
  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const contentOpacity = useSharedValue(1);
  const prevVisibleKeysRef = useRef<string | null>(null);

  const movePillTo = (key: CategoryKey, animate: boolean) => {
    const node = chipRefs.current[key];
    const row = rowRef.current;
    if (!node || !row) return;
    // @ts-ignore - measureLayout is exposed by the host component both the
    // View and the TouchableOpacity ref forward to on native and web.
    node.measureLayout(
      row,
      (x: number, _y: number, width: number) => {
        if (animate) {
          pillX.value = withTiming(x, { duration: DURATION.fast, easing: EASING.standard });
          pillWidth.value = withTiming(width, { duration: DURATION.fast, easing: EASING.standard });
        } else {
          pillX.value = x;
          pillWidth.value = width;
        }
      },
      () => {}
    );
  };

  const handleCategoryChange = (key: CategoryKey) => {
    if (key === activeCategory) return;
    setActiveCategory(key);
    movePillTo(key, true);
    // Content cross-fades rather than slides (Motion Design System:
    // "Category tab / chip switch") - sliding both the pill and the
    // content underneath would be two competing horizontal motions.
    contentOpacity.value = withTiming(0, { duration: DURATION.fast, easing: EASING.easeIn }, (finished) => {
      if (finished) {
        runOnJS(setDisplayedCategory)(key);
        contentOpacity.value = withTiming(1, { duration: DURATION.fast, easing: EASING.easeOut });
      }
    });
  };

  const contentAnimatedStyle = useAnimatedStyle(() => ({ opacity: contentOpacity.value }));
  const pillAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width: pillWidth.value,
  }));

  const loadCompany = useCallback(async () => {
    try {
      const data = await api.getCompany();
      setCompany(data);
    } catch (error) {
      // No company yet
    }
  }, []);

  const loadMemberships = useCallback(async () => {
    try {
      const data = await api.getCompanyMemberships();
      setMemberships(data);
    } catch (error) {
      // Not critical - the switcher simply stays hidden
    }
  }, []);

  // Tab screens stay mounted, so returning from company-settings after an
  // edit doesn't remount this screen - only re-fetching on focus picks up
  // the change without needing a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      loadCompany();
      loadMemberships();
    }, [loadCompany, loadMemberships])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshUser(), loadCompany(), loadMemberships()]);
    } catch (error) {
      console.error('Error refreshing profile:', error);
    }
    setRefreshing(false);
  }, [refreshUser, loadCompany, loadMemberships]);

  const handleSwitchCompany = async (companyId: string) => {
    if (companyId === company?.id) {
      setShowSwitcherModal(false);
      return;
    }
    setSwitching(companyId);
    try {
      await api.switchCompany(companyId);
      await Promise.all([refreshUser(), loadCompany(), loadMemberships()]);
      setShowSwitcherModal(false);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSwitching(null);
    }
  };

  const handleCreateCompany = async () => {
    if (!newCompanyName.trim() || !newCompanyEik.trim()) {
      Alert.alert(t('common.error'), t('companySwitcher.newCompanyMissingFields'));
      return;
    }
    setCreatingCompany(true);
    try {
      await api.createAdditionalCompany({ name: newCompanyName.trim(), eik: newCompanyEik.trim() });
      setShowNewCompanyModal(false);
      setShowSwitcherModal(false);
      setNewCompanyName('');
      setNewCompanyEik('');
      await Promise.all([refreshUser(), loadCompany(), loadMemberships()]);
      Toast.success(t('companySwitcher.newCompanyCreated'));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setCreatingCompany(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      t('profile.logout'),
      t('profile.logoutConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.logout'),
          style: 'destructive',
          onPress: async () => {
            // The root layout's auth guard redirects to "/" as soon as
            // isAuthenticated flips false - no manual navigation needed.
            await logout();
          },
        },
      ]
    );
  };

  const handleLanguageChange = async (newLang: Language) => {
    await setLanguage(newLang);
    setShowLanguageModal(false);
  };

  const getRoleName = (role: string) => sharedGetRoleName(role, language);

  interface MenuItemDef {
    key: string;
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    iconBg: string;
    iconColor: string;
    onPress: () => void;
  }

  const allCategories: { key: CategoryKey; label: string; icon: keyof typeof Ionicons.glyphMap; items: MenuItemDef[] }[] = [
    {
      key: 'company',
      label: t('profile.category.company'),
      icon: 'briefcase-outline',
      items: [
        ...(hasPermission('manage_company') || !company
          ? [{
              key: 'company',
              title: t('profile.company'),
              subtitle: company ? t('profile.companyData') : t('profile.noCompanyYet'),
              icon: 'business' as const,
              iconBg: 'rgba(59, 130, 246, 0.15)',
              iconColor: COLORS.info,
              onPress: () => router.push('/company-settings'),
            }]
          : []),
        ...(hasPermission('manage_users')
          ? [{
              key: 'users',
              title: t('profile.users'),
              subtitle: t('profile.usersDesc'),
              icon: 'people' as const,
              iconBg: 'rgba(236, 72, 153, 0.15)',
              iconColor: COLORS.pink,
              onPress: () => router.push('/users-management'),
            }]
          : []),
        ...(hasPermission('team_collaboration')
          ? [{
              key: 'calendar',
              title: t('profile.calendar'),
              subtitle: t('profile.calendarDesc'),
              icon: 'calendar' as const,
              iconBg: 'rgba(139, 92, 246, 0.15)',
              iconColor: COLORS.primary,
              onPress: () => router.push('/calendar'),
            }]
          : []),
        ...(hasPermission('team_collaboration')
          ? [{
              key: 'messages',
              title: t('profile.messages'),
              subtitle: t('profile.messagesDesc'),
              icon: 'chatbubbles' as const,
              iconBg: 'rgba(16, 185, 129, 0.15)',
              iconColor: COLORS.success,
              onPress: () => router.push('/messages'),
            }]
          : []),
        ...(hasPermission('manage_company')
          ? [{
              key: 'closedDays',
              title: t('profile.closedDays'),
              subtitle: t('profile.closedDaysDesc'),
              icon: 'calendar-outline' as const,
              iconBg: 'rgba(239, 68, 68, 0.15)',
              iconColor: COLORS.danger,
              onPress: () => router.push('/closed-days'),
            }]
          : []),
      ],
    },
    {
      key: 'accounting',
      label: t('profile.category.accounting'),
      icon: 'calculator-outline',
      items: [
        ...(hasPermission('manage_budget')
          ? [{
              key: 'budget',
              title: t('profile.budget'),
              subtitle: t('profile.budgetDesc'),
              icon: 'wallet' as const,
              iconBg: 'rgba(139, 92, 246, 0.15)',
              iconColor: COLORS.primary,
              onPress: () => router.push('/budget'),
            }]
          : []),
        ...(hasPermission('manage_budget')
          ? [{
              key: 'payroll',
              title: t('payroll.title'),
              subtitle: t('profile.payrollDesc'),
              icon: 'people' as const,
              iconBg: 'rgba(16, 185, 129, 0.15)',
              iconColor: COLORS.success,
              onPress: () => router.push('/payroll'),
            }]
          : []),
        ...(hasPermission('manage_budget')
          ? [{
              key: 'absences',
              title: t('absences.title'),
              subtitle: t('profile.absencesDesc'),
              icon: 'sunny' as const,
              iconBg: 'rgba(245, 158, 11, 0.15)',
              iconColor: COLORS.warning,
              onPress: () => router.push('/employee-absences'),
            }]
          : []),
        ...(hasPermission('manage_budget')
          ? [{
              key: 'assets',
              title: t('assets.title'),
              subtitle: t('profile.assetsDesc'),
              icon: 'business' as const,
              iconBg: 'rgba(245, 158, 11, 0.15)',
              iconColor: COLORS.warning,
              onPress: () => router.push('/assets'),
            }]
          : []),
        ...(hasPermission('view_statistics')
          ? [{
              key: 'protocols',
              title: t('profile.protocols'),
              subtitle: t('profile.protocolsDesc'),
              icon: 'document-text' as const,
              iconBg: 'rgba(139, 92, 246, 0.15)',
              iconColor: COLORS.primary,
              onPress: () => router.push('/protocols'),
            }]
          : []),
        ...(hasPermission('export_data')
          ? [{
              key: 'export',
              title: t('profile.export'),
              subtitle: t('profile.exportDesc'),
              icon: 'download' as const,
              iconBg: 'rgba(236, 72, 153, 0.15)',
              iconColor: COLORS.pink,
              onPress: () => router.push('/export'),
            }]
          : []),
      ],
    },
    {
      key: 'security',
      label: t('profile.category.security'),
      icon: 'shield-checkmark-outline',
      items: [
        {
          key: 'accountSecurity',
          title: t('profile.accountSecurity'),
          subtitle: user?.has_password ? t('profile.changePassword') : t('profile.setPasswordForEmail'),
          icon: 'lock-closed',
          iconBg: 'rgba(16, 185, 129, 0.15)',
          iconColor: COLORS.success,
          onPress: () => router.push('/account-security'),
        },
        ...(hasPermission('view_audit_log')
          ? [{
              key: 'auditLog',
              title: t('profile.auditLog'),
              subtitle: t('profile.auditLogDesc'),
              icon: 'list' as const,
              iconBg: 'rgba(99, 102, 241, 0.15)',
              iconColor: COLORS.indigo,
              onPress: () => router.push('/audit-log'),
            }]
          : []),
        ...(isOwner
          ? [{
              key: 'backup',
              title: t('profile.backup'),
              subtitle: t('profile.backupRestore'),
              icon: 'cloud-upload' as const,
              iconBg: 'rgba(16, 185, 129, 0.15)',
              iconColor: COLORS.success,
              onPress: () => router.push('/backup'),
            }]
          : []),
      ],
    },
    {
      key: 'settings',
      label: t('profile.category.settings'),
      icon: 'settings-outline',
      items: [
        {
          key: 'notifications',
          title: t('profile.notifications'),
          subtitle: t('profile.vatNotifications'),
          icon: 'notifications',
          iconBg: 'rgba(139, 92, 246, 0.15)',
          iconColor: COLORS.primary,
          onPress: () => router.push('/notifications-settings'),
        },
        {
          key: 'scanCredits',
          title: t('scanCredits.title'),
          subtitle: t('scanCredits.totalRemaining'),
          icon: 'scan',
          iconBg: 'rgba(139, 92, 246, 0.15)',
          iconColor: COLORS.primary,
          onPress: () => router.push('/scan-credits'),
        },
        {
          key: 'language',
          title: t('profile.language'),
          subtitle: language === 'bg' ? t('profile.languageBulgarian') : t('profile.languageEnglish'),
          icon: 'language',
          iconBg: 'rgba(245, 158, 11, 0.15)',
          iconColor: COLORS.warning,
          onPress: () => setShowLanguageModal(true),
        },
      ],
    },
    {
      key: 'support',
      label: t('profile.category.support'),
      icon: 'help-buoy-outline',
      items: [
        {
          key: 'help',
          title: t('profile.help'),
          subtitle: t('profile.howToUse'),
          icon: 'help-circle',
          iconBg: 'rgba(99, 102, 241, 0.15)',
          iconColor: COLORS.indigo,
          onPress: () => router.push('/help'),
        },
        {
          key: 'privacyPolicy',
          title: t('profile.privacyPolicy'),
          subtitle: t('profile.privacyPolicyDesc'),
          icon: 'shield-checkmark',
          iconBg: 'rgba(16, 185, 129, 0.15)',
          iconColor: COLORS.success,
          onPress: () => router.push('/privacy-policy'),
        },
        {
          key: 'termsOfService',
          title: t('profile.termsOfService'),
          subtitle: t('profile.termsOfServiceDesc'),
          icon: 'document-text',
          iconBg: 'rgba(245, 158, 11, 0.15)',
          iconColor: COLORS.warning,
          onPress: () => router.push('/terms-of-service'),
        },
      ],
    },
  ];

  const visibleCategories = allCategories.filter((c) => c.items.length > 0);
  const visibleKeysSignature = visibleCategories.map((c) => c.key).join(',');
  if (prevVisibleKeysRef.current !== null && prevVisibleKeysRef.current !== visibleKeysSignature) {
    if (activeCategory !== null && !visibleCategories.some((c) => c.key === activeCategory)) {
      // The active category's permission was revoked out from under it
      // (edge case - a role change mid-session) - fall back to the first
      // category that's still actually visible.
      setActiveCategory(visibleCategories[0]?.key ?? null);
      setDisplayedCategory(visibleCategories[0]?.key ?? null);
    }
  }
  prevVisibleKeysRef.current = visibleKeysSignature;
  if (activeCategory === null && visibleCategories.length > 0) {
    // First render: pick the first visible category without going through
    // the animated transition - there's nothing on screen yet to cross-fade from.
    setActiveCategory(visibleCategories[0].key);
    setDisplayedCategory(visibleCategories[0].key);
  }
  const currentItems = visibleCategories.find((c) => c.key === displayedCategory)?.items || [];

  // Re-snap the pill (no animation - this isn't a user action) whenever the
  // set of visible categories changes, e.g. once `user` finishes loading a
  // beat after first paint and a permission-gated category's chip appears
  // or disappears, shifting everyone after it.
  useEffect(() => {
    if (activeCategory) movePillTo(activeCategory, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKeysSignature, activeCategory]);

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <ScrollView 
            style={styles.scrollView}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[COLORS.primary]}
                tintColor={COLORS.primary}
              />
            }
          >
            <View style={styles.header}>
              <Text style={styles.title}>{t('profile.title')}</Text>
              <TouchableOpacity
                style={styles.headerLogoutButton}
                onPress={handleLogout}
                accessibilityLabel={t('profile.logout')}
              >
                <Ionicons name="log-out-outline" size={22} color={COLORS.danger} />
              </TouchableOpacity>
            </View>

            {/* Company Banner - always opens the switcher, which also has
                the "add another company" entry point, not just a way to
                jump between companies you already have. */}
            {company && (
              <TouchableOpacity style={styles.companyBanner} onPress={() => setShowSwitcherModal(true)} accessibilityLabel={t('companySwitcher.switchCompany')}>
                <Ionicons name="business" size={20} color={COLORS.primary} />
                <Text style={styles.companyName}>{company.name}</Text>
                <Ionicons name="swap-horizontal" size={18} color={COLORS.primary} />
              </TouchableOpacity>
            )}

            {/* User Card */}
            <View style={styles.userCard}>
              <View style={styles.avatarContainer}>
                {user?.picture ? (
                  <Image source={{ uri: user.picture }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Ionicons name="person" size={40} color={COLORS.primary} />
                  </View>
                )}
              </View>
              <Text style={styles.userName}>{user?.name || t('role.user')}</Text>
              <Text style={styles.userEmail}>{user?.email || ''}</Text>
              <View style={styles.roleContainer}>
                <Ionicons
                  name={user?.role === 'owner' ? 'star' : user?.role === 'manager' ? 'briefcase' : user?.role === 'accountant' ? 'calculator' : 'person'}
                  size={16}
                  color={getRoleColor(user?.role || 'staff')}
                />
                <Text style={[styles.roleText, { color: getRoleColor(user?.role || 'staff') }]}>
                  {getRoleName(user?.role || 'staff')}
                </Text>
              </View>
        </View>

        {/* Category selector - replaces the old flat 20-row list (Motion
            Design Audit's Profile IA proposal). A sliding pill tracks the
            active chip; the row below cross-fades when it changes. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
        >
          <View ref={rowRef} style={styles.categoryRow}>
            <Animated.View style={[styles.categoryPill, pillAnimatedStyle]} />
            {visibleCategories.map((cat) => (
              <TouchableOpacity
                key={cat.key}
                ref={(node) => { chipRefs.current[cat.key] = node; }}
                style={styles.categoryChip}
                onPress={() => handleCategoryChange(cat.key)}
              >
                <Ionicons
                  name={cat.icon}
                  size={15}
                  color={activeCategory === cat.key ? 'white' : COLORS.textMuted}
                />
                <Text style={[styles.categoryChipText, activeCategory === cat.key && styles.categoryChipTextActive]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <Animated.View style={[styles.menuSection, contentAnimatedStyle]}>
          {currentItems.map((item) => (
            <TouchableOpacity key={item.key} style={styles.menuItem} onPress={item.onPress}>
              <View style={[styles.menuIcon, { backgroundColor: item.iconBg }]}>
                <Ionicons name={item.icon} size={20} color={item.iconColor} />
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuTitle}>{item.title}</Text>
                <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
        </Animated.View>

            {/* Logout Button */}
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Ionicons name="log-out" size={20} color={COLORS.danger} />
              <Text style={styles.logoutText}>{t('profile.logout')}</Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </View>
      
      {/* Language Selection Modal */}
      <Modal
        visible={showLanguageModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLanguageModal(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1}
          onPress={() => setShowLanguageModal(false)}
        >
          <View style={styles.languageModalContent}>
            <Text style={styles.languageModalTitle}>{t('login.selectLanguage')}</Text>
            
            <TouchableOpacity 
              style={[styles.languageOption, language === 'bg' && styles.languageOptionActive]}
              onPress={() => handleLanguageChange('bg')}
            >
              <Text style={styles.languageFlag}>🇧🇬</Text>
              <Text style={styles.languageText}>Български</Text>
              {language === 'bg' && <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />}
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.languageOption, language === 'en' && styles.languageOptionActive]}
              onPress={() => handleLanguageChange('en')}
            >
              <Text style={styles.languageFlag}>🇬🇧</Text>
              <Text style={styles.languageText}>English</Text>
              {language === 'en' && <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />}
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.languageModalCancel}
              onPress={() => setShowLanguageModal(false)}
            >
              <Text style={styles.languageModalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Company Switcher Modal */}
      <Modal
        visible={showSwitcherModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSwitcherModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowSwitcherModal(false)}
        >
          <View style={styles.switcherModalContent}>
            <Text style={styles.languageModalTitle}>{t('companySwitcher.yourCompanies')}</Text>

            {memberships.map((m) => (
              <TouchableOpacity
                key={m.company_id}
                style={[styles.switcherOption, m.is_active && styles.switcherOptionActive]}
                onPress={() => handleSwitchCompany(m.company_id)}
                disabled={!!switching}
              >
                <View style={styles.switcherOptionIcon}>
                  <Ionicons name="business" size={18} color={m.is_active ? COLORS.primary : COLORS.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switcherOptionName}>{m.company_name}</Text>
                  <Text style={[styles.switcherOptionRole, { color: getRoleColor(m.role) }]}>
                    {getRoleName(m.role)}
                  </Text>
                </View>
                {switching === m.company_id ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : m.is_active ? (
                  <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
                ) : null}
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.switcherAddOption}
              onPress={() => { setShowSwitcherModal(false); setShowNewCompanyModal(true); }}
            >
              <View style={styles.switcherOptionIcon}>
                <Ionicons name="add-circle-outline" size={18} color={COLORS.success} />
              </View>
              <Text style={styles.switcherAddOptionText}>{t('companySwitcher.addAnother')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.languageModalCancel}
              onPress={() => setShowSwitcherModal(false)}
            >
              <Text style={styles.languageModalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* New Company Modal - creates an ADDITIONAL company the user also
          owns (multiple separate businesses), distinct from editing the
          currently active one in Company Settings. */}
      <Modal
        visible={showNewCompanyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNewCompanyModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowNewCompanyModal(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.switcherModalContent} onPress={() => {}}>
            <Text style={styles.languageModalTitle}>{t('companySwitcher.addAnother')}</Text>
            <Text style={styles.newCompanyHint}>{t('companySwitcher.newCompanyHint')}</Text>

            <Text style={styles.newCompanyLabel}>{t('company.name')}</Text>
            <TextInput
              style={styles.newCompanyInput}
              value={newCompanyName}
              onChangeText={setNewCompanyName}
              placeholder={t('company.name')}
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={styles.newCompanyLabel}>{t('company.eik')}</Text>
            <TextInput
              style={styles.newCompanyInput}
              value={newCompanyEik}
              onChangeText={setNewCompanyEik}
              placeholder={t('company.eik')}
              placeholderTextColor={COLORS.textMuted}
              keyboardType="number-pad"
            />

            <TouchableOpacity
              style={[styles.newCompanySubmit, creatingCompany && { opacity: 0.6 }]}
              onPress={handleCreateCompany}
              disabled={creatingCompany}
            >
              {creatingCompany ? <ActivityIndicator color="white" /> : (
                <Text style={styles.newCompanySubmitText}>{t('common.save')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.languageModalCancel}
              onPress={() => setShowNewCompanyModal(false)}
            >
              <Text style={styles.languageModalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  header: {
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLogoutButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  companyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  companyName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
    flex: 1,
  },
  userCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: COLORS.primary,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: COLORS.primary,
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  roleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  roleText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  roleTextAccountant: {
    color: COLORS.primary,
  },
  categoryScroll: {
    marginBottom: 16,
    flexGrow: 0,
  },
  categoryRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 4,
    gap: 2,
  },
  categoryPill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 0,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  categoryChipTextActive: {
    color: 'white',
  },
  menuSection: {
    marginBottom: 24,
  },
  menuSectionTitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
    marginBottom: 12,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuContent: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: 'white',
  },
  menuSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.danger,
  },
  
  // Language Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  languageModalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 24,
    width: '85%',
    maxWidth: 340,
  },
  languageModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 20,
  },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  languageOptionActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  languageFlag: {
    fontSize: 28,
  },
  languageText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    flex: 1,
  },
  languageModalCancel: {
    alignItems: 'center',
    padding: 12,
    marginTop: 8,
  },
  languageModalCancelText: {
    fontSize: 16,
    color: COLORS.textMuted,
  },
  switcherModalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 24,
    width: '90%',
    maxWidth: 380,
  },
  switcherOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  switcherOptionActive: {
    borderColor: 'rgba(139, 92, 246, 0.4)',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
  },
  switcherOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  switcherOptionName: {
    fontSize: 15,
    fontWeight: '600',
    color: 'white',
  },
  switcherOptionRole: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  switcherAddOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  switcherAddOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.success,
  },
  newCompanyHint: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  newCompanyLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  newCompanyInput: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: 'white',
    fontSize: 15,
    marginBottom: 14,
  },
  newCompanySubmit: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  newCompanySubmitText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
