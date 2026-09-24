import React, { useState, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from '../../src/utils/alert';
import { useAuth } from '../../src/contexts/AuthContext';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation, useLanguageStore, Language } from '../../src/i18n';
import { api } from '../../src/services/api';
import { Company, CompanyMembership } from '../../src/types';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageStore();
  const { user, logout, refreshUser, hasPermission } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [memberships, setMemberships] = useState<CompanyMembership[]>([]);
  const [showSwitcherModal, setShowSwitcherModal] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

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

  const getRoleName = (role: string) => {
    const roles: Record<string, { bg: string; en: string }> = {
      owner: { bg: 'Титуляр', en: 'Owner' },
      manager: { bg: 'Мениджър', en: 'Manager' },
      staff: { bg: 'Служител', en: 'Staff' },
      accountant: { bg: 'Счетоводител', en: 'Accountant' },
    };
    return roles[role]?.[language] || role;
  };

  const getRoleColor = (role: string) => {
    const colors: Record<string, string> = {
      owner: '#8B5CF6',
      manager: '#3B82F6',
      staff: '#64748B',
      accountant: '#F59E0B',
    };
    return colors[role] || '#64748B';
  };

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
                colors={['#8B5CF6']}
                tintColor="#8B5CF6"
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
                <Ionicons name="log-out-outline" size={22} color="#EF4444" />
              </TouchableOpacity>
            </View>

            {/* Company Banner - tappable switcher when the user has access to more than one company */}
            {company && (
              memberships.length > 1 ? (
                <TouchableOpacity style={styles.companyBanner} onPress={() => setShowSwitcherModal(true)}>
                  <Ionicons name="business" size={20} color="#8B5CF6" />
                  <Text style={styles.companyName}>{company.name}</Text>
                  <Ionicons name="swap-horizontal" size={18} color="#8B5CF6" />
                </TouchableOpacity>
              ) : (
                <View style={styles.companyBanner}>
                  <Ionicons name="business" size={20} color="#8B5CF6" />
                  <Text style={styles.companyName}>{company.name}</Text>
                </View>
              )
            )}

            {/* User Card */}
            <View style={styles.userCard}>
              <View style={styles.avatarContainer}>
                {user?.picture ? (
                  <Image source={{ uri: user.picture }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Ionicons name="person" size={40} color="#8B5CF6" />
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

        {/* Menu Items */}
        <View style={styles.menuSection}>
          <Text style={styles.menuSectionTitle}>{t('profile.settings')}</Text>

          {/* Users Management - Only for Owner */}
          {hasPermission('manage_users') && (
            <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/users-management')}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(236, 72, 153, 0.15)' }]}>
                <Ionicons name="people" size={20} color="#EC4899" />
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuTitle}>{language === 'bg' ? 'Потребители' : 'Users'}</Text>
                <Text style={styles.menuSubtitle}>{language === 'bg' ? 'Управление и покани' : 'Manage & invite'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#64748B" />
            </TouchableOpacity>
          )}

          {/* Company Settings - Owner, or anyone without a company yet (create/join) */}
          {(hasPermission('manage_company') || !company) && (
            <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/company-settings')}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                <Ionicons name="business" size={20} color="#3B82F6" />
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuTitle}>{t('profile.company')}</Text>
                <Text style={styles.menuSubtitle}>
                  {company
                    ? t('profile.companyData')
                    : (language === 'bg' ? 'Създайте фирма или се присъединете по покана' : 'Create a company or join by invitation')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#64748B" />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/account-security')}>
            <View style={[styles.menuIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Ionicons name="lock-closed" size={20} color="#10B981" />
            </View>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>{language === 'bg' ? 'Акаунт и сигурност' : 'Account & Security'}</Text>
              <Text style={styles.menuSubtitle}>
                {user?.has_password
                  ? (language === 'bg' ? 'Смяна на парола' : 'Change password')
                  : (language === 'bg' ? 'Задайте парола за вход с имейл' : 'Set a password for email login')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#64748B" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/notifications-settings')}>
            <View style={[styles.menuIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
              <Ionicons name="notifications" size={20} color="#8B5CF6" />
            </View>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>{t('profile.notifications')}</Text>
              <Text style={styles.menuSubtitle}>{t('profile.vatNotifications')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#64748B" />
          </TouchableOpacity>

          {/* Budget - Owner and Manager only */}
          {hasPermission('manage_budget') && (
            <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/budget')}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                <Ionicons name="wallet" size={20} color="#8B5CF6" />
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuTitle}>{t('profile.budget')}</Text>
                <Text style={styles.menuSubtitle}>{t('profile.budgetDesc')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#64748B" />
            </TouchableOpacity>
          )}

          {/* Payroll - Owner and Manager */}
          {hasPermission('manage_budget') && (
            <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/payroll')}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                <Ionicons name="people" size={20} color="#10B981" />
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuTitle}>{t('payroll.title')}</Text>
                <Text style={styles.menuSubtitle}>{t('profile.payrollDesc')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#64748B" />
            </TouchableOpacity>
          )}

          {/* Fixed Assets (ДМА) - Owner and Manager */}
          {hasPermission('manage_budget') && (
            <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/assets')}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                <Ionicons name="business" size={20} color="#F59E0B" />
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuTitle}>{t('assets.title')}</Text>
                <Text style={styles.menuSubtitle}>{t('profile.assetsDesc')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#64748B" />
            </TouchableOpacity>
          )}

          {/* Audit Log - Owner only */}
          {hasPermission('view_audit_log') && (
            <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/audit-log')}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(99, 102, 241, 0.15)' }]}>
                <Ionicons name="list" size={20} color="#6366F1" />
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuTitle}>{t('profile.auditLog')}</Text>
                <Text style={styles.menuSubtitle}>{t('profile.auditLogDesc')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#64748B" />
            </TouchableOpacity>
          )}

          {/* VAT Protocols (чл.117) - Owner and Manager */}
          {hasPermission('view_statistics') && (
            <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/protocols')}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                <Ionicons name="document-text" size={20} color="#8B5CF6" />
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuTitle}>{t('profile.protocols')}</Text>
                <Text style={styles.menuSubtitle}>{t('profile.protocolsDesc')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#64748B" />
            </TouchableOpacity>
          )}

          {/* Export - Owner and Manager only */}
          {hasPermission('export_data') && (
            <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/export')}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(236, 72, 153, 0.15)' }]}>
                <Ionicons name="download" size={20} color="#EC4899" />
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuTitle}>{t('profile.export')}</Text>
                <Text style={styles.menuSubtitle}>{t('profile.exportDesc')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#64748B" />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/backup')}>
            <View style={[styles.menuIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Ionicons name="cloud-upload" size={20} color="#10B981" />
            </View>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>{t('profile.backup')}</Text>
              <Text style={styles.menuSubtitle}>{t('profile.backupRestore')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#64748B" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowLanguageModal(true)}>
            <View style={[styles.menuIcon, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
              <Ionicons name="language" size={20} color="#F59E0B" />
            </View>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>{t('profile.language')}</Text>
              <Text style={styles.menuSubtitle}>{language === 'bg' ? '🇧🇬 Български' : '🇬🇧 English'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#64748B" />
          </TouchableOpacity>
        </View>

        <View style={styles.menuSection}>
          <Text style={styles.menuSectionTitle}>{t('profile.info')}</Text>

          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/help')}>
            <View style={[styles.menuIcon, { backgroundColor: 'rgba(99, 102, 241, 0.15)' }]}>
              <Ionicons name="help-circle" size={20} color="#6366F1" />
            </View>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>{t('profile.help')}</Text>
              <Text style={styles.menuSubtitle}>{t('profile.howToUse')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#64748B" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/privacy-policy')}>
            <View style={[styles.menuIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Ionicons name="shield-checkmark" size={20} color="#10B981" />
            </View>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>{language === 'bg' ? 'Поверителност' : 'Privacy Policy'}</Text>
              <Text style={styles.menuSubtitle}>{language === 'bg' ? 'Защита на данните' : 'Data protection'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#64748B" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/terms-of-service')}>
            <View style={[styles.menuIcon, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
              <Ionicons name="document-text" size={20} color="#F59E0B" />
            </View>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>{language === 'bg' ? 'Условия' : 'Terms of Service'}</Text>
              <Text style={styles.menuSubtitle}>{language === 'bg' ? 'Правила за ползване' : 'Usage rules'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#64748B" />
          </TouchableOpacity>
        </View>

            {/* Logout Button */}
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Ionicons name="log-out" size={20} color="#EF4444" />
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
              {language === 'bg' && <Ionicons name="checkmark-circle" size={24} color="#8B5CF6" />}
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.languageOption, language === 'en' && styles.languageOptionActive]}
              onPress={() => handleLanguageChange('en')}
            >
              <Text style={styles.languageFlag}>🇬🇧</Text>
              <Text style={styles.languageText}>English</Text>
              {language === 'en' && <Ionicons name="checkmark-circle" size={24} color="#8B5CF6" />}
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
                  <Ionicons name="business" size={18} color={m.is_active ? '#8B5CF6' : '#94A3B8'} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switcherOptionName}>{m.company_name}</Text>
                  <Text style={[styles.switcherOptionRole, { color: getRoleColor(m.role) }]}>
                    {getRoleName(m.role)}
                  </Text>
                </View>
                {switching === m.company_id ? (
                  <ActivityIndicator size="small" color="#8B5CF6" />
                ) : m.is_active ? (
                  <Ionicons name="checkmark-circle" size={22} color="#8B5CF6" />
                ) : null}
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.languageModalCancel}
              onPress={() => setShowSwitcherModal(false)}
            >
              <Text style={styles.languageModalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
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
    color: '#8B5CF6',
    flex: 1,
  },
  userCard: {
    backgroundColor: '#1E293B',
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
    borderColor: '#8B5CF6',
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#8B5CF6',
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 12,
  },
  roleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  roleText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  roleTextAccountant: {
    color: '#8B5CF6',
  },
  menuSection: {
    marginBottom: 24,
  },
  menuSectionTitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginBottom: 12,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
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
    color: '#64748B',
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
    color: '#EF4444',
  },
  
  // Language Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  languageModalContent: {
    backgroundColor: '#1E293B',
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
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  languageOptionActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderWidth: 2,
    borderColor: '#8B5CF6',
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
    color: '#64748B',
  },
  switcherModalContent: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 24,
    width: '90%',
    maxWidth: 380,
  },
  switcherOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
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
});
