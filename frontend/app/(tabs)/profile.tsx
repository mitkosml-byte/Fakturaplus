import React, { useState, useCallback } from 'react';
import { AmbientGlow } from '../../src/components/AmbientGlow';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ImageBackground,
  RefreshControl,
  Modal,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Alert } from '../../src/utils/alert';
import { Toast } from '../../src/utils/toast';
import { Haptics } from '../../src/utils/haptics';
import { useAuth } from '../../src/contexts/AuthContext';
import { useModules } from '../../src/stores/modulesStore';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation, useLanguageStore, Language } from '../../src/i18n';
import { api } from '../../src/services/api';
import { Company, CompanyMembership } from '../../src/types';
import { getRoleName as sharedGetRoleName, getRoleColor } from '../../src/utils/roles';
import { Avatar } from '../../src/components/Avatar';
import { AvatarCropModal } from '../../src/components/AvatarCropModal';
import { BirthdaySheet } from '../../src/components/BirthdaySheet';
import { COLORS } from '../../src/theme/colors';

// A profile picture is a small icon shown everywhere (team list, chat,
// calendar, audit log) - not read for fine detail like an invoice scan,
// so it's resized down hard before upload regardless of what the OS
// picker/cropper handed back, keeping every user document's picture
// field cheap to store and fetch.
const AVATAR_TARGET_SIZE = 320;

// Takes the already-chosen square crop (from AvatarCropModal - the user's
// own positioning, or its centered default if they never dragged) and
// scales just that region down to the stored size.
async function prepareAvatarImage(uri: string, crop: { originX: number; originY: number; size: number }): Promise<string> {
  const context = ImageManipulator.manipulate(uri)
    .crop({ originX: crop.originX, originY: crop.originY, width: crop.size, height: crop.size })
    .resize({ width: AVATAR_TARGET_SIZE, height: AVATAR_TARGET_SIZE });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG, base64: true });
  return `data:image/jpeg;base64,${saved.base64}`;
}

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageStore();
  const { user, logout, refreshUser, setUser, hasPermission, isOwner } = useAuth();
  const { uses } = useModules();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
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

  // Account (Л7): every section listed under its own title - nothing
  // hidden behind chips; a section shows only with an item this person sees.
  type CategoryKey = 'company' | 'accounting' | 'security' | 'settings' | 'support';

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
  // One's own birthday (day and month) - see BirthdaySheet.
  const [birthday, setBirthday] = useState<string | null>(null);
  const [showBirthday, setShowBirthday] = useState(false);
  const loadBirthday = useCallback(async () => {
    try {
      setBirthday((await api.getMyBirthday()).birthday);
    } catch {
      setBirthday(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCompany();
      loadMemberships();
      loadBirthday();
    }, [loadCompany, loadMemberships, loadBirthday])
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
      Haptics.success();
      Toast.success(t('companySwitcher.newCompanyCreated'));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setCreatingCompany(false);
    }
  };

  // The OS picker's own allowsEditing/aspect crop UI differs by platform
  // (and the web build skips it entirely), so cropping is instead always
  // done with AvatarCropModal below - one consistent, user-draggable
  // positioning step regardless of platform.
  const [pickedAvatar, setPickedAvatar] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [cropModalVisible, setCropModalVisible] = useState(false);

  const handlePickAvatar = async () => {
    // Gallery picker only (no camera-vs-gallery choice) - same tradeoff
    // assets.tsx/payroll.tsx already accept, and it sidesteps the Alert
    // utility's web fallback only properly handling a 2-button
    // confirm/cancel, not a 3-way source picker.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setPickedAvatar({ uri: asset.uri, width: asset.width, height: asset.height });
    setCropModalVisible(true);
  };

  const handleCropCancel = () => {
    setCropModalVisible(false);
    setPickedAvatar(null);
  };

  const handleCropConfirm = async (crop: { originX: number; originY: number; size: number }) => {
    if (!pickedAvatar) return;
    setCropModalVisible(false);
    setUploadingAvatar(true);
    try {
      const dataUri = await prepareAvatarImage(pickedAvatar.uri, crop);
      await api.updateMyPicture(dataUri);
      setUser(user ? { ...user, picture: dataUri } : user);
      await refreshUser();
      Haptics.success();
    } catch (error) {
      console.error('Error uploading avatar:', error);
      Alert.alert(t('common.error'), t('profile.avatarUploadError'));
    } finally {
      setUploadingAvatar(false);
      setPickedAvatar(null);
    }
  };

  const handleRemoveAvatar = () => {
    Alert.alert(t('profile.removeAvatarTitle'), t('profile.removeAvatarConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setUploadingAvatar(true);
          try {
            await api.updateMyPicture(null);
            setUser(user ? { ...user, picture: null } : user);
            await refreshUser();
          } catch (error) {
            console.error('Error removing avatar:', error);
            Alert.alert(t('common.error'), t('profile.avatarUploadError'));
          } finally {
            setUploadingAvatar(false);
          }
        },
      },
    ]);
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

  // "11-19" as "19 ноември".
  const birthdayText = (value: string) => {
    const months = language === 'en'
      ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      : ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
    const month = months[Number(value.slice(0, 2)) - 1] || '';
    const day = Number(value.slice(3));
    return language === 'en' ? `${month} ${day}` : `${day} ${month}`;
  };

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
        ...(company && (hasPermission('manage_company') || (hasPermission('view_statistics') && hasPermission('view_profit')))
          ? [{
              key: 'locations',
              title: t('locations.title'),
              subtitle: t('locations.menuDesc'),
              icon: 'storefront-outline' as const,
              iconBg: 'rgba(16, 185, 129, 0.15)',
              iconColor: COLORS.success,
              onPress: () => router.push('/locations'),
            }]
          : []),
        ...(uses('till') && hasPermission('manage_company')
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
        ...(user?.role === 'owner' || user?.role === 'manager'
          ? [{
              key: 'deadlines',
              title: t('deadlines.title'),
              subtitle: t('deadlines.menuDesc'),
              icon: 'alarm-outline' as const,
              iconBg: 'rgba(245, 158, 11, 0.15)',
              iconColor: COLORS.warning,
              onPress: () => router.push('/deadlines'),
            }]
          : []),
      ],
    },
    {
      key: 'accounting',
      label: t('profile.category.accounting'),
      icon: 'calculator-outline',
      items: [
        // One central hub for every history/records screen - previously
        // each one only existed scattered under its own Home stat card,
        // modal button, or menu item, with no single place that listed
        // them all (Module 3 audit finding).
        {
          key: 'historyHub',
          title: t('historyHub.title'),
          subtitle: t('historyHub.subtitle'),
          icon: 'time-outline' as const,
          iconBg: 'rgba(20, 184, 166, 0.15)',
          iconColor: COLORS.teal,
          onPress: () => router.push('/history-hub'),
        },
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
          key: 'birthday',
          title: t('birthday.title'),
          subtitle: birthday ? birthdayText(birthday) : t('birthday.notSet'),
          icon: 'gift-outline',
          iconBg: 'rgba(236, 72, 153, 0.15)',
          iconColor: '#EC4899',
          onPress: () => setShowBirthday(true),
        },
        {
          key: 'notifications',
          title: t('profile.notifications'),
          subtitle: t('profile.vatNotifications'),
          icon: 'notifications',
          iconBg: 'rgba(139, 92, 246, 0.15)',
          iconColor: COLORS.primary,
          onPress: () => router.push('/notifications-settings'),
        },
        // manage_invoices-gated - same permission already gating the
        // Scan/Invoices tabs and the backend endpoints this screen calls
        // (balance/history/packages). A staff member with nothing granted
        // used to see this entry and the full screen behind it (balance +
        // real transaction history) despite having no reason to ever
        // touch scan credits.
        ...(hasPermission('manage_invoices')
          ? [{
              key: 'scanCredits',
              title: t('scanCredits.title'),
              subtitle: t('scanCredits.totalRemaining'),
              icon: 'scan' as const,
              iconBg: 'rgba(139, 92, 246, 0.15)',
              iconColor: COLORS.primary,
              onPress: () => router.push('/scan-credits'),
            }]
          : []),
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
        // Whether the program works and the errors it met (the owner's own
        // company's) - the "Състояние" screen.
        ...(isOwner
          ? [{
              key: 'systemStatus',
              title: t('status.menuTitle'),
              subtitle: t('status.menuDesc'),
              icon: 'pulse' as const,
              iconBg: 'rgba(16, 185, 129, 0.15)',
              iconColor: COLORS.success,
              onPress: () => router.push('/system-status'),
            }]
          : []),
      ],
    },
  ];

  const visibleCategories = allCategories.filter((c) => c.items.length > 0);

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <AmbientGlow />
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
            </View>

            {/* Who is signed in, in one row - the picture changes with a tap,
                a long press removes it. */}
            <View style={styles.userCard}>
              <TouchableOpacity
                style={styles.avatarContainer}
                onPress={handlePickAvatar}
                onLongPress={user?.picture ? handleRemoveAvatar : undefined}
                disabled={uploadingAvatar}
                accessibilityLabel={t('profile.changeAvatar')}
              >
                <Avatar uri={user?.picture} name={user?.name} size={52} />
                <View style={styles.avatarEditBadge}>
                  {uploadingAvatar ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Ionicons name="camera" size={11} color="white" />
                  )}
                </View>
              </TouchableOpacity>
              <View style={styles.userInfo}>
                <Text style={styles.userName} numberOfLines={1}>{user?.name || t('role.user')}</Text>
                <Text style={styles.userEmail} numberOfLines={1}>{user?.email || ''}</Text>
                <View style={styles.roleContainer}>
                  <Ionicons
                    name={user?.role === 'owner' ? 'star' : user?.role === 'manager' ? 'briefcase' : user?.role === 'accountant' ? 'calculator' : 'person'}
                    size={13}
                    color={getRoleColor(user?.role || 'staff')}
                  />
                  <Text style={[styles.roleText, { color: getRoleColor(user?.role || 'staff') }]}>
                    {getRoleName(user?.role || 'staff')}
                  </Text>
                </View>
              </View>
            </View>

            {/* The company - a tap opens the switcher, which also adds another. */}
            {company && (
              <TouchableOpacity style={styles.companyBanner} onPress={() => setShowSwitcherModal(true)} accessibilityLabel={t('companySwitcher.switchCompany')}>
                <Ionicons name="business" size={18} color={COLORS.primary} />
                <Text style={styles.companyName} numberOfLines={1}>{company.name}</Text>
                <Ionicons name="swap-horizontal" size={16} color={COLORS.primary} />
              </TouchableOpacity>
            )}

            {visibleCategories.map((category) => (
              <View key={category.key} style={styles.menuSection}>
                <Text style={styles.sectionTitle}>{category.label}</Text>
                <View style={styles.sectionCard}>
                {category.items.map((item, index) => (
                  <TouchableOpacity
                    key={item.key}
                    style={[styles.menuItem, index > 0 && styles.menuItemDivider]}
                    onPress={item.onPress}
                  >
                    <View style={[styles.menuIcon, { backgroundColor: item.iconBg }]}>
                      <Ionicons name={item.icon} size={18} color={item.iconColor} />
                    </View>
                    <View style={styles.menuContent}>
                      <Text style={styles.menuTitle}>{item.title}</Text>
                      <Text style={styles.menuSubtitle} numberOfLines={1}>{item.subtitle}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                ))}
                </View>
              </View>
            ))}

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

      <BirthdaySheet
        visible={showBirthday}
        birthday={birthday}
        onClose={() => setShowBirthday(false)}
        onSaved={setBirthday}
      />

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

      <AvatarCropModal
        visible={cropModalVisible}
        imageUri={pickedAvatar?.uri ?? null}
        imageWidth={pickedAvatar?.width ?? 1}
        imageHeight={pickedAvatar?.height ?? 1}
        onCancel={handleCropCancel}
        onConfirm={handleCropConfirm}
      />
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
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  // Who is signed in, in one row.
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  avatarContainer: {
    padding: 2,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfo: { flex: 1 },
  userName: {
    fontSize: 17,
    fontWeight: 'bold',
    color: 'white',
  },
  userEmail: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  roleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 6,
    backgroundColor: COLORS.background,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  roleTextAccountant: {
    color: COLORS.primary,
  },
  companyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 20,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  companyName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
    flex: 1,
  },
  // Each section: its title, then its items in one card.
  menuSection: {
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '700',
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCard: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  menuItemDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  menuIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
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
    marginTop: 1,
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
