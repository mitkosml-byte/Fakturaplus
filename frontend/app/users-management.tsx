import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  ImageBackground,
  RefreshControl,
  Share,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api } from '@/src/services/api';
import { User, Invitation, Role } from '@/src/types';
import { useAuth } from '@/src/contexts/AuthContext';
import { useTranslation, useLanguageStore } from '../src/i18n';
import * as Clipboard from 'expo-clipboard';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

// Базов URL за покани (ще се използва за deep linking)
const getInviteBaseUrl = () => {
  // За production използвайте реалния домейн
  return 'https://invoice-app.example.com/invite';
};

export default function UsersManagementScreen() {
  const { t } = useTranslation();
  const { language } = useLanguageStore();
  const { user: currentUser, refreshUser } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  
  // Invitation modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteRole, setInviteRole] = useState<string>('staff');
  const [inviting, setInviting] = useState(false);
  
  // Share modal (след създаване на покана)
  const [showShareModal, setShowShareModal] = useState(false);
  const [createdInvitation, setCreatedInvitation] = useState<{
    code: string;
    invite_token: string;
    company_name: string;
    role: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [usersData, invitationsData, rolesData] = await Promise.all([
        api.getCompanyUsers(),
        api.getInvitations(),
        api.getAvailableRoles(),
      ]);
      setUsers(usersData);
      setInvitations(invitationsData);
      setAvailableRoles(rolesData.roles);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // Генериране на линк за покана
  const getInviteLink = (token: string) => {
    return `${getInviteBaseUrl()}/${token}`;
  };

  // Генериране на съобщение за покана
  const getInviteMessage = (companyName: string, token: string, code: string) => {
    const link = getInviteLink(token);
    const roleName = getRoleName(createdInvitation?.role || 'staff');
    
    if (language === 'bg') {
      return `Поканени сте да се присъедините към "${companyName}" като ${roleName}!\n\n` +
        `Линк за присъединяване:\n${link}\n\n` +
        `Или въведете код: ${code}\n\n` +
        `Валидност: 48 часа`;
    }
    return `You're invited to join "${companyName}" as ${roleName}!\n\n` +
      `Join link:\n${link}\n\n` +
      `Or enter code: ${code}\n\n` +
      `Valid for: 48 hours`;
  };

  const handleInvite = async () => {
    setInviting(true);
    try {
      const result = await api.createInvitation({
        role: inviteRole,
      });
      
      setCreatedInvitation({
        code: result.invitation.code,
        invite_token: result.invitation.invite_token,
        company_name: result.invitation.company_name,
        role: result.invitation.role,
      });
      setShowInviteModal(false);
      setShowShareModal(true);
      
      await loadData();
    } catch (error: any) {
      Alert.alert(
        language === 'bg' ? 'Грешка' : 'Error',
        error.message
      );
    } finally {
      setInviting(false);
    }
  };

  // Споделяне чрез системния Share API
  const handleShareGeneric = async () => {
    if (!createdInvitation) return;
    
    const message = getInviteMessage(
      createdInvitation.company_name,
      createdInvitation.invite_token,
      createdInvitation.code
    );
    
    try {
      await Share.share({ message });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  // Споделяне чрез Viber
  const handleShareViber = async () => {
    if (!createdInvitation) return;
    
    const message = getInviteMessage(
      createdInvitation.company_name,
      createdInvitation.invite_token,
      createdInvitation.code
    );
    
    const viberUrl = `viber://forward?text=${encodeURIComponent(message)}`;
    
    try {
      const canOpen = await Linking.canOpenURL(viberUrl);
      if (canOpen) {
        await Linking.openURL(viberUrl);
      } else {
        Alert.alert(
          language === 'bg' ? 'Viber не е инсталиран' : 'Viber not installed',
          language === 'bg' ? 'Моля инсталирайте Viber или използвайте друг начин за споделяне.' : 'Please install Viber or use another sharing method.'
        );
      }
    } catch (error) {
      console.error('Error opening Viber:', error);
    }
  };

  // Споделяне чрез WhatsApp
  const handleShareWhatsApp = async () => {
    if (!createdInvitation) return;
    
    const message = getInviteMessage(
      createdInvitation.company_name,
      createdInvitation.invite_token,
      createdInvitation.code
    );
    
    const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
    
    try {
      const canOpen = await Linking.canOpenURL(whatsappUrl);
      if (canOpen) {
        await Linking.openURL(whatsappUrl);
      } else {
        Alert.alert(
          language === 'bg' ? 'WhatsApp не е инсталиран' : 'WhatsApp not installed',
          language === 'bg' ? 'Моля инсталирайте WhatsApp или използвайте друг начин за споделяне.' : 'Please install WhatsApp or use another sharing method.'
        );
      }
    } catch (error) {
      console.error('Error opening WhatsApp:', error);
    }
  };

  // Споделяне чрез SMS
  const handleShareSMS = async () => {
    if (!createdInvitation) return;
    
    const message = getInviteMessage(
      createdInvitation.company_name,
      createdInvitation.invite_token,
      createdInvitation.code
    );
    
    const smsUrl = Platform.OS === 'ios' 
      ? `sms:&body=${encodeURIComponent(message)}`
      : `sms:?body=${encodeURIComponent(message)}`;
    
    try {
      await Linking.openURL(smsUrl);
    } catch (error) {
      console.error('Error opening SMS:', error);
    }
  };

  // Споделяне чрез Email
  const handleShareEmail = async () => {
    if (!createdInvitation) return;
    
    const subject = language === 'bg' 
      ? `Покана за присъединяване към ${createdInvitation.company_name}`
      : `Invitation to join ${createdInvitation.company_name}`;
    
    const body = getInviteMessage(
      createdInvitation.company_name,
      createdInvitation.invite_token,
      createdInvitation.code
    );
    
    const emailUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    
    try {
      await Linking.openURL(emailUrl);
    } catch (error) {
      console.error('Error opening email:', error);
    }
  };

  // Копиране на линка
  const handleCopyLink = async () => {
    if (!createdInvitation) return;
    
    const link = getInviteLink(createdInvitation.invite_token);
    await Clipboard.setStringAsync(link);
    Alert.alert(
      language === 'bg' ? 'Копирано!' : 'Copied!',
      language === 'bg' ? 'Линкът е копиран в клипборда' : 'Link copied to clipboard'
    );
  };

  const handleCancelInvitation = async (invitationId: string) => {
    Alert.alert(
      language === 'bg' ? 'Отмяна на покана' : 'Cancel Invitation',
      language === 'bg' ? 'Сигурни ли сте?' : 'Are you sure?',
      [
        { text: language === 'bg' ? 'Не' : 'No', style: 'cancel' },
        {
          text: language === 'bg' ? 'Да' : 'Yes',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.cancelInvitation(invitationId);
              await loadData();
            } catch (error: any) {
              Alert.alert(language === 'bg' ? 'Грешка' : 'Error', error.message);
            }
          },
        },
      ]
    );
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    try {
      await api.updateUserRole(userId, newRole);
      await loadData();
      Alert.alert(
        language === 'bg' ? 'Успех' : 'Success',
        language === 'bg' ? 'Ролята е променена' : 'Role updated'
      );
    } catch (error: any) {
      Alert.alert(language === 'bg' ? 'Грешка' : 'Error', error.message);
    }
  };

  const handleRemoveUser = async (userId: string, userName: string) => {
    Alert.alert(
      language === 'bg' ? 'Премахване' : 'Remove',
      language === 'bg' 
        ? `Сигурни ли сте, че искате да премахнете ${userName}?`
        : `Are you sure you want to remove ${userName}?`,
      [
        { text: language === 'bg' ? 'Отказ' : 'Cancel', style: 'cancel' },
        {
          text: language === 'bg' ? 'Премахни' : 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.removeUserFromCompany(userId);
              await loadData();
            } catch (error: any) {
              Alert.alert(language === 'bg' ? 'Грешка' : 'Error', error.message);
            }
          },
        },
      ]
    );
  };

  const getRoleName = (role: string) => {
    const roles: Record<string, { bg: string; en: string }> = {
      owner: { bg: 'Титуляр', en: 'Owner' },
      manager: { bg: 'Мениджър', en: 'Manager' },
      accountant: { bg: 'Счетоводител', en: 'Accountant' },
      staff: { bg: 'Служител', en: 'Staff' },
      viewer: { bg: 'Само преглед', en: 'Viewer' },
    };
    return roles[role]?.[language] || role;
  };

  const getRoleColor = (role: string) => {
    const colors: Record<string, string> = {
      owner: '#8B5CF6',
      manager: '#3B82F6',
      accountant: '#10B981',
      staff: '#64748B',
      viewer: '#94A3B8',
    };
    return colors[role] || '#64748B';
  };

  if (loading) {
    return (
      <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#8B5CF6" />
          </SafeAreaView>
        </View>
      </ImageBackground>
    );
  }

  // Only owner can access this screen
  if (currentUser?.role !== 'owner') {
    return (
      <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.container}>
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                <Ionicons name="arrow-back" size={24} color="white" />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>
                {language === 'bg' ? 'Потребители' : 'Users'}
              </Text>
              <View style={styles.headerRight} />
            </View>
            <View style={styles.noAccessContainer}>
              <Ionicons name="lock-closed" size={64} color="#EF4444" />
              <Text style={styles.noAccessText}>
                {language === 'bg' 
                  ? 'Само титулярят има достъп до тази секция'
                  : 'Only the owner has access to this section'}
              </Text>
            </View>
          </SafeAreaView>
        </View>
      </ImageBackground>
    );
  }

  const pendingInvitations = invitations.filter(i => i.status === 'pending');

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>
              {language === 'bg' ? 'Потребители' : 'Users'}
            </Text>
            <TouchableOpacity style={styles.addButton} onPress={() => setShowInviteModal(true)}>
              <Ionicons name="person-add" size={24} color="#8B5CF6" />
            </TouchableOpacity>
          </View>

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
            {/* Users List */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {language === 'bg' ? 'Членове на фирмата' : 'Company Members'} ({users.length})
              </Text>
              
              {users.map((user) => (
                <View key={user.user_id} style={styles.userCard}>
                  <View style={styles.userInfo}>
                    <View style={styles.avatarContainer}>
                      {user.picture ? (
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>
                            {user.name?.charAt(0)?.toUpperCase() || '?'}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.avatar}>
                          <Ionicons name="person" size={20} color="white" />
                        </View>
                      )}
                    </View>
                    <View style={styles.userDetails}>
                      <Text style={styles.userName}>{user.name}</Text>
                      <Text style={styles.userEmail}>{user.email}</Text>
                    </View>
                  </View>
                  
                  <View style={styles.userActions}>
                    <View style={[styles.roleBadge, { backgroundColor: getRoleColor(user.role) + '20' }]}>
                      <Text style={[styles.roleText, { color: getRoleColor(user.role) }]}>
                        {getRoleName(user.role)}
                      </Text>
                    </View>
                    
                    {user.user_id !== currentUser?.user_id && (
                      <View style={styles.actionButtons}>
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => {
                            Alert.alert(
                              language === 'bg' ? 'Промяна на роля' : 'Change Role',
                              language === 'bg' ? 'Изберете нова роля' : 'Select new role',
                              [
                                { text: language === 'bg' ? 'Отказ' : 'Cancel', style: 'cancel' },
                                { text: getRoleName('manager'), onPress: () => handleChangeRole(user.user_id, 'manager') },
                                { text: getRoleName('accountant'), onPress: () => handleChangeRole(user.user_id, 'accountant') },
                                { text: getRoleName('staff'), onPress: () => handleChangeRole(user.user_id, 'staff') },
                                { text: getRoleName('viewer'), onPress: () => handleChangeRole(user.user_id, 'viewer') },
                              ]
                            );
                          }}
                        >
                          <Ionicons name="create" size={18} color="#8B5CF6" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => handleRemoveUser(user.user_id, user.name)}
                        >
                          <Ionicons name="person-remove" size={18} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              ))}
            </View>

            {/* Pending Invitations */}
            {pendingInvitations.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {language === 'bg' ? 'Чакащи покани' : 'Pending Invitations'} ({pendingInvitations.length})
                </Text>
                
                {pendingInvitations.map((invitation) => (
                  <View key={invitation.id} style={styles.invitationCard}>
                    <View style={styles.invitationInfo}>
                      <Ionicons name="mail" size={20} color="#F59E0B" />
                      <View style={styles.invitationDetails}>
                        <Text style={styles.invitationContact}>
                          {invitation.email || invitation.phone}
                        </Text>
                        <Text style={styles.invitationCode}>
                          {language === 'bg' ? 'Код' : 'Code'}: {invitation.code}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.invitationActions}>
                      <View style={[styles.roleBadge, { backgroundColor: getRoleColor(invitation.role) + '20' }]}>
                        <Text style={[styles.roleText, { color: getRoleColor(invitation.role) }]}>
                          {getRoleName(invitation.role)}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.cancelButton}
                        onPress={() => handleCancelInvitation(invitation.id)}
                      >
                        <Ionicons name="close-circle" size={24} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>

          {/* Invite Modal */}
          <Modal visible={showInviteModal} animationType="slide" transparent>
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    {language === 'bg' ? 'Покани потребител' : 'Invite User'}
                  </Text>
                  <TouchableOpacity onPress={() => setShowInviteModal(false)}>
                    <Ionicons name="close" size={28} color="#94A3B8" />
                  </TouchableOpacity>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>
                    {language === 'bg' ? 'Имейл' : 'Email'}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={inviteEmail}
                    onChangeText={setInviteEmail}
                    placeholder="user@example.com"
                    placeholderTextColor="#64748B"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>

                <Text style={styles.orText}>
                  {language === 'bg' ? '— или —' : '— or —'}
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>
                    {language === 'bg' ? 'Телефон' : 'Phone'}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={invitePhone}
                    onChangeText={setInvitePhone}
                    placeholder="+359 888 123456"
                    placeholderTextColor="#64748B"
                    keyboardType="phone-pad"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>
                    {language === 'bg' ? 'Роля' : 'Role'}
                  </Text>
                  <View style={styles.roleSelector}>
                    <TouchableOpacity
                      style={[styles.roleOption, inviteRole === 'staff' && styles.roleOptionActive]}
                      onPress={() => setInviteRole('staff')}
                    >
                      <Text style={[styles.roleOptionText, inviteRole === 'staff' && styles.roleOptionTextActive]}>
                        {getRoleName('staff')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.roleOption, inviteRole === 'manager' && styles.roleOptionActive]}
                      onPress={() => setInviteRole('manager')}
                    >
                      <Text style={[styles.roleOptionText, inviteRole === 'manager' && styles.roleOptionTextActive]}>
                        {getRoleName('manager')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.inviteButton, inviting && styles.buttonDisabled]}
                  onPress={handleInvite}
                  disabled={inviting}
                >
                  {inviting ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Ionicons name="send" size={20} color="white" />
                      <Text style={styles.inviteButtonText}>
                        {language === 'bg' ? 'Създай покана' : 'Create Invitation'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* Invitation Code Modal */}
          <Modal visible={showCodeModal} animationType="fade" transparent>
            <View style={styles.modalOverlay}>
              <View style={styles.codeModalContent}>
                <Ionicons name="checkmark-circle" size={64} color="#10B981" />
                <Text style={styles.codeModalTitle}>
                  {language === 'bg' ? 'Поканата е създадена!' : 'Invitation Created!'}
                </Text>
                <Text style={styles.codeModalSubtitle}>
                  {language === 'bg' 
                    ? 'Споделете кода с поканения потребител:'
                    : 'Share this code with the invited user:'}
                </Text>
                
                <View style={styles.codeBox}>
                  <Text style={styles.codeText}>{invitationCode}</Text>
                </View>

                <View style={styles.codeActions}>
                  <TouchableOpacity style={styles.codeActionButton} onPress={handleCopyCode}>
                    <Ionicons name="copy" size={20} color="#8B5CF6" />
                    <Text style={styles.codeActionText}>
                      {language === 'bg' ? 'Копирай' : 'Copy'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.codeActionButton} onPress={handleShareCode}>
                    <Ionicons name="share-social" size={20} color="#8B5CF6" />
                    <Text style={styles.codeActionText}>
                      {language === 'bg' ? 'Сподели' : 'Share'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.closeCodeButton}
                  onPress={() => setShowCodeModal(false)}
                >
                  <Text style={styles.closeCodeButtonText}>
                    {language === 'bg' ? 'Готово' : 'Done'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
  },
  headerRight: {
    width: 40,
  },
  addButton: {
    padding: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderRadius: 8,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 12,
  },
  userCard: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarContainer: {
    marginRight: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '500',
    color: 'white',
    marginBottom: 2,
  },
  userEmail: {
    fontSize: 13,
    color: '#94A3B8',
  },
  userActions: {
    alignItems: 'flex-end',
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
  },
  invitationCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  invitationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  invitationDetails: {
    marginLeft: 12,
    flex: 1,
  },
  invitationContact: {
    fontSize: 14,
    color: 'white',
    fontWeight: '500',
  },
  invitationCode: {
    fontSize: 12,
    color: '#F59E0B',
    marginTop: 2,
  },
  invitationActions: {
    alignItems: 'flex-end',
  },
  cancelButton: {
    marginTop: 8,
  },
  noAccessContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  noAccessText: {
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: 'white',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: 'white',
    borderWidth: 1,
    borderColor: '#334155',
  },
  orText: {
    textAlign: 'center',
    color: '#64748B',
    marginVertical: 8,
  },
  roleSelector: {
    flexDirection: 'row',
    gap: 12,
  },
  roleOption: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#334155',
  },
  roleOptionActive: {
    borderColor: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  roleOptionText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#64748B',
  },
  roleOptionTextActive: {
    color: '#8B5CF6',
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  inviteButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  codeModalContent: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    margin: 24,
    padding: 32,
    alignItems: 'center',
  },
  codeModalTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: 'white',
    marginTop: 16,
    marginBottom: 8,
  },
  codeModalSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 24,
  },
  codeBox: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 24,
    borderWidth: 2,
    borderColor: '#8B5CF6',
    borderStyle: 'dashed',
  },
  codeText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#8B5CF6',
    letterSpacing: 4,
  },
  codeActions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 24,
  },
  codeActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderRadius: 12,
  },
  codeActionText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8B5CF6',
  },
  closeCodeButton: {
    marginTop: 24,
    padding: 16,
    paddingHorizontal: 48,
    backgroundColor: '#334155',
    borderRadius: 12,
  },
  closeCodeButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: 'white',
  },
});
