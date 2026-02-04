import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  Image,
  ImageBackground,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { useRouter } from 'expo-router';
import { useTranslation, useLanguageStore, Language } from '../../src/i18n';
import { api } from '../../src/services/api';
import { Company } from '../../src/types';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageStore();
  const { user, logout, refreshUser } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  const loadCompany = useCallback(async () => {
    try {
      const data = await api.getCompany();
      setCompany(data);
    } catch (error) {
      // No company yet
    }
  }, []);

  useEffect(() => {
    loadCompany();
  }, [loadCompany]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshUser(), loadCompany()]);
    } catch (error) {
      console.error('Error refreshing profile:', error);
    }
    setRefreshing(false);
  }, [refreshUser, loadCompany]);

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
            await logout();
            router.replace('/');
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
    };
    return roles[role]?.[language] || role;
  };

  const getRoleColor = (role: string) => {
    const colors: Record<string, string> = {
      owner: '#8B5CF6',
      manager: '#3B82F6',
      staff: '#64748B',
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
            </View>

            {/* Company Banner */}
            {company && (
              <View style={styles.companyBanner}>
                <Ionicons name="business" size={20} color="#8B5CF6" />
                <Text style={styles.companyName}>{company.name}</Text>
              </View>
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
                  name={user?.role === 'owner' ? 'star' : user?.role === 'manager' ? 'briefcase' : 'person'} 
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
          {user?.role === 'owner' && (
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

          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/company-settings')}>
            <View style={[styles.menuIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
              <Ionicons name="business" size={20} color="#3B82F6" />
            </View>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>{t('profile.company')}</Text>
              <Text style={styles.menuSubtitle}>{t('profile.companyData')}</Text>
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

          <TouchableOpacity style={styles.menuItem}>
            <View style={[styles.menuIcon, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
              <Ionicons name="language" size={20} color="#F59E0B" />
            </View>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>{t('profile.language')}</Text>
              <Text style={styles.menuSubtitle}>Български / English</Text>
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

          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/help')}>
            <View style={[styles.menuIcon, { backgroundColor: 'rgba(236, 72, 153, 0.15)' }]}>
              <Ionicons name="information-circle" size={20} color="#EC4899" />
            </View>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>{t('profile.about')}</Text>
              <Text style={styles.menuSubtitle}>{t('profile.version')} 1.0.0</Text>
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
});
