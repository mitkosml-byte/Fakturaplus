import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Modal,
  ImageBackground,
  RefreshControl,
  Share,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Alert } from '../src/utils/alert';
import { api } from '../src/services/api';
import { User, Invitation, OwnerAction } from '../src/types';
import { useAuth } from '../src/contexts/AuthContext';
import { useTranslation, useLanguageStore } from '../src/i18n';
import * as Clipboard from 'expo-clipboard';
import { getRoleName as sharedGetRoleName, getRoleColor } from '../src/utils/roles';
import { ROLE_DEFAULT_PERMISSIONS, ConfigurableRole } from '../src/utils/permissions';

// The role pickers below offer "owner" alongside the three configurable
// roles, but an owner's permission set is always the full fixed set (see
// ROLE_PERMISSIONS in backend/server.py) - never checklist-configurable -
// so it's handled as a distinct branch wherever ConfigurableRole drives UI.
type PickableRole = ConfigurableRole | 'owner';
import { PermissionsChecklist } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function UsersManagementScreen() {
  const { t } = useTranslation();
  const { language } = useLanguageStore();
  const { user: currentUser, refreshUser } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [ownerActions, setOwnerActions] = useState<OwnerAction[]>([]);

  // Invitation modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState<PickableRole>('staff');
  const [invitePermissions, setInvitePermissions] = useState<string[]>(ROLE_DEFAULT_PERMISSIONS.staff);
  const [inviting, setInviting] = useState(false);

  // Invitation code modal
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [invitationCode, setInvitationCode] = useState('');
  const [companyName, setCompanyName] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [usersData, invitationsData, ownerActionsData] = await Promise.all([
        api.getCompanyUsers(),
        api.getInvitations(),
        api.getOwnerActions(),
      ]);
      setUsers(usersData);
      setInvitations(invitationsData);
      setOwnerActions(ownerActionsData);
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

  // Switching role resets the checklist to that role's defaults - fine-tuning
  // is meant to start from a sensible baseline each time, not carry over
  // ticks that may not even apply to the newly-picked role. "owner" has no
  // checklist at all - the role always carries the full fixed permission set.
  const handleSelectInviteRole = (role: PickableRole) => {
    setInviteRole(role);
    setInvitePermissions(role === 'owner' ? [] : ROLE_DEFAULT_PERMISSIONS[role]);
  };

  const toggleInvitePermission = (permission: string) => {
    setInvitePermissions(prev =>
      prev.includes(permission) ? prev.filter(p => p !== permission) : [...prev, permission]
    );
  };

  const handleInvite = async () => {
    if (!inviteEmail && !invitePhone) {
      Alert.alert(
        language === 'bg' ? 'Грешка' : 'Error',
        language === 'bg' ? 'Въведете имейл или телефон' : 'Enter email or phone'
      );
      return;
    }

    setInviting(true);
    try {
      const result = await api.createInvitation({
        email: inviteEmail || undefined,
        phone: invitePhone || undefined,
        role: inviteRole,
        // Owner always carries the full fixed permission set server-side -
        // omitting the field (not sending []) is what tells resolve_permissions
        // to use that default instead of intersecting against an empty ceiling.
        permissions: inviteRole === 'owner' ? undefined : invitePermissions,
      });

      setInvitationCode(result.invitation.code);
      setCompanyName(result.invitation.company_name);
      setShowInviteModal(false);
      setShowCodeModal(true);
      setInviteEmail('');
      setInvitePhone('');
      setInviteRole('staff');
      setInvitePermissions(ROLE_DEFAULT_PERMISSIONS.staff);

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

  const handleCopyCode = async () => {
    await Clipboard.setStringAsync(invitationCode);
    Alert.alert(
      language === 'bg' ? 'Копирано!' : 'Copied!',
      language === 'bg' ? 'Кодът е копиран в клипборда' : 'Code copied to clipboard'
    );
  };

  const handleShareCode = async () => {
    const message = language === 'bg'
      ? `Поканен сте да се присъедините към ${companyName}!\n\nКод за достъп: ${invitationCode}\n\nОтворете приложението Фактура+ и въведете кода в Профил → Фирма → Присъединяване по покана.`
      : `You are invited to join ${companyName}!\n\nAccess code: ${invitationCode}\n\nOpen the Fakturaplus app and enter the code in Profile → Company → Join by Invitation.`;
    
    try {
      await Share.share({ message });
    } catch (error) {
      console.error('Error sharing:', error);
    }
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

  // Edit access modal (role + permissions checklist) for an existing member
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editRole, setEditRole] = useState<PickableRole>('staff');
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [savingAccess, setSavingAccess] = useState(false);

  const openEditAccess = (user: User) => {
    const role = user.role as PickableRole;
    setEditingUser(user);
    setEditRole(role);
    setEditPermissions(
      role === 'owner' ? [] : (user.permissions && user.permissions.length > 0 ? user.permissions : ROLE_DEFAULT_PERMISSIONS[role])
    );
  };

  // Same as at invite time - switching role starts the checklist over at
  // that role's defaults, since a permission ticked for the old role may
  // not even be offered for the new one. "owner" has no checklist.
  const handleSelectEditRole = (role: PickableRole) => {
    setEditRole(role);
    setEditPermissions(role === 'owner' ? [] : ROLE_DEFAULT_PERMISSIONS[role]);
  };

  const toggleEditPermission = (permission: string) => {
    setEditPermissions(prev =>
      prev.includes(permission) ? prev.filter(p => p !== permission) : [...prev, permission]
    );
  };

  const handleSaveAccess = async () => {
    if (!editingUser) return;
    setSavingAccess(true);
    try {
      const result = await api.updateUserRole(
        editingUser.user_id,
        editRole,
        editRole === 'owner' ? undefined : editPermissions
      );
      await loadData();
      setEditingUser(null);
      if (result.status === 'pending_approval') {
        Alert.alert(
          language === 'bg' ? 'Изисква се одобрение' : 'Approval required',
          result.message
        );
      } else {
        Alert.alert(
          language === 'bg' ? 'Успех' : 'Success',
          language === 'bg' ? 'Достъпът е обновен' : 'Access updated'
        );
      }
    } catch (error: any) {
      Alert.alert(language === 'bg' ? 'Грешка' : 'Error', error.message);
    } finally {
      setSavingAccess(false);
    }
  };

  const handleRemoveUser = async (user: User) => {
    const isOwnerTarget = user.role === 'owner';
    Alert.alert(
      language === 'bg' ? 'Премахване' : 'Remove',
      isOwnerTarget
        ? (language === 'bg'
            ? `${user.name} е собственик. Премахването ще създаде заявка, която трябва да бъде одобрена от другите собственици.`
            : `${user.name} is an owner. Removal will create a request that the other owners must approve.`)
        : (language === 'bg'
            ? `Сигурни ли сте, че искате да премахнете ${user.name}?`
            : `Are you sure you want to remove ${user.name}?`),
      [
        { text: language === 'bg' ? 'Отказ' : 'Cancel', style: 'cancel' },
        {
          text: isOwnerTarget
            ? (language === 'bg' ? 'Изпрати заявка' : 'Send request')
            : (language === 'bg' ? 'Премахни' : 'Remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await api.removeUserFromCompany(user.user_id);
              await loadData();
              if (result.status === 'pending_approval') {
                Alert.alert(language === 'bg' ? 'Изисква се одобрение' : 'Approval required', result.message);
              }
            } catch (error: any) {
              Alert.alert(language === 'bg' ? 'Грешка' : 'Error', error.message);
            }
          },
        },
      ]
    );
  };

  const handleApproveOwnerAction = async (action: OwnerAction) => {
    try {
      const result = await api.approveOwnerAction(action.id);
      await loadData();
      if (result.status === 'executed') {
        Alert.alert(
          language === 'bg' ? 'Изпълнено' : 'Executed',
          language === 'bg' ? 'Заявката получи всички нужни одобрения и беше изпълнена.' : 'The request received all required approvals and was executed.'
        );
      }
    } catch (error: any) {
      Alert.alert(language === 'bg' ? 'Грешка' : 'Error', error.message);
    }
  };

  const handleRejectOwnerAction = async (action: OwnerAction) => {
    try {
      await api.rejectOwnerAction(action.id);
      await loadData();
    } catch (error: any) {
      Alert.alert(language === 'bg' ? 'Грешка' : 'Error', error.message);
    }
  };

  const getRoleName = (role: string) => sharedGetRoleName(role, language);

  if (loading) {
    return (
      <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
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
              <Ionicons name="lock-closed" size={64} color={COLORS.danger} />
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
              <Ionicons name="person-add" size={24} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

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
                          onPress={() => openEditAccess(user)}
                        >
                          <Ionicons name="create" size={18} color={COLORS.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => handleRemoveUser(user)}
                        >
                          <Ionicons name="person-remove" size={18} color={COLORS.danger} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              ))}
            </View>

            {/* Pending owner removal/demotion requests - visible to every
                owner, including the target, per the transparency-as-a-
                safeguard design (see request_owner_status_change). */}
            {ownerActions.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {t('users.pendingOwnerActions')} ({ownerActions.length})
                </Text>
                {ownerActions.map((action) => {
                  const canDecide = !!currentUser && action.required_approver_ids.includes(currentUser.user_id);
                  const canReject = canDecide || currentUser?.user_id === action.target_user_id || currentUser?.user_id === action.requested_by;
                  const alreadyApproved = !!currentUser && action.approved_by.includes(currentUser.user_id);
                  const actionLabel = action.action === 'remove' ? t('users.ownerActionRemove') : getRoleName(action.action);
                  return (
                    <View key={action.id} style={styles.ownerActionCard}>
                      <Text style={styles.ownerActionText}>
                        {t('users.ownerActionSummary')
                          .replace('{requester}', action.requested_by_name)
                          .replace('{target}', action.target_name)
                          .replace('{action}', actionLabel)}
                      </Text>
                      <Text style={styles.ownerActionProgress}>
                        {t('users.ownerActionApprovals')}: {action.approved_by.length} / {action.required_approver_ids.length + 1}
                      </Text>
                      <View style={styles.ownerActionButtons}>
                        {canDecide && !alreadyApproved && (
                          <TouchableOpacity style={styles.ownerActionApprove} onPress={() => handleApproveOwnerAction(action)}>
                            <Text style={styles.ownerActionApproveText}>{t('users.approve')}</Text>
                          </TouchableOpacity>
                        )}
                        {canReject && (
                          <TouchableOpacity style={styles.ownerActionReject} onPress={() => handleRejectOwnerAction(action)}>
                            <Text style={styles.ownerActionRejectText}>{t('users.reject')}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Pending Invitations */}
            {pendingInvitations.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {language === 'bg' ? 'Чакащи покани' : 'Pending Invitations'} ({pendingInvitations.length})
                </Text>
                
                {pendingInvitations.map((invitation) => (
                  <View key={invitation.id} style={styles.invitationCard}>
                    <View style={styles.invitationInfo}>
                      <Ionicons name="mail" size={20} color={COLORS.warning} />
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
                        <Ionicons name="close-circle" size={24} color={COLORS.danger} />
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
              <View style={[styles.modalContent, styles.modalContentScrollable]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    {language === 'bg' ? 'Покани потребител' : 'Invite User'}
                  </Text>
                  <TouchableOpacity onPress={() => setShowInviteModal(false)}>
                    <Ionicons name="close" size={28} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>
                    {language === 'bg' ? 'Имейл' : 'Email'}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={inviteEmail}
                    onChangeText={setInviteEmail}
                    placeholder="user@example.com"
                    placeholderTextColor={COLORS.textMuted}
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
                    placeholderTextColor={COLORS.textMuted}
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
                      onPress={() => handleSelectInviteRole('staff')}
                    >
                      <Text style={[styles.roleOptionText, inviteRole === 'staff' && styles.roleOptionTextActive]}>
                        {getRoleName('staff')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.roleOption, inviteRole === 'manager' && styles.roleOptionActive]}
                      onPress={() => handleSelectInviteRole('manager')}
                    >
                      <Text style={[styles.roleOptionText, inviteRole === 'manager' && styles.roleOptionTextActive]}>
                        {getRoleName('manager')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.roleOption, inviteRole === 'accountant' && styles.roleOptionActive]}
                      onPress={() => handleSelectInviteRole('accountant')}
                    >
                      <Text style={[styles.roleOptionText, inviteRole === 'accountant' && styles.roleOptionTextActive]}>
                        {getRoleName('accountant')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.roleOption, inviteRole === 'owner' && styles.roleOptionActive]}
                      onPress={() => handleSelectInviteRole('owner')}
                    >
                      <Text style={[styles.roleOptionText, inviteRole === 'owner' && styles.roleOptionTextActive]}>
                        {getRoleName('owner')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {inviteRole === 'accountant' && (
                    <Text style={styles.accountantHint}>{t('invitations.accountantHint')}</Text>
                  )}
                  {inviteRole === 'owner' && (
                    <Text style={styles.accountantHint}>{t('users.ownerInviteHint')}</Text>
                  )}
                </View>

                {inviteRole !== 'owner' && (
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('invitations.permissionsTitle')}</Text>
                    <Text style={styles.permissionsHint}>{t('invitations.permissionsHint')}</Text>
                    <PermissionsChecklist
                      role={inviteRole}
                      selected={invitePermissions}
                      onToggle={toggleInvitePermission}
                    />
                  </View>
                )}

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
                </ScrollView>
              </View>
            </View>
          </Modal>

          {/* Edit Access Modal - role + permissions checklist for an existing member */}
          <Modal visible={!!editingUser} animationType="slide" transparent>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, styles.modalContentScrollable]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{t('users.editAccess')}</Text>
                  <TouchableOpacity onPress={() => setEditingUser(null)}>
                    <Ionicons name="close" size={28} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {editingUser && (
                    <>
                      <Text style={styles.editingUserName}>{editingUser.name}</Text>
                      <Text style={styles.editingUserEmail}>{editingUser.email}</Text>

                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{t('users.role')}</Text>
                        <View style={styles.roleSelector}>
                          <TouchableOpacity
                            style={[styles.roleOption, editRole === 'staff' && styles.roleOptionActive]}
                            onPress={() => handleSelectEditRole('staff')}
                          >
                            <Text style={[styles.roleOptionText, editRole === 'staff' && styles.roleOptionTextActive]}>
                              {getRoleName('staff')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.roleOption, editRole === 'manager' && styles.roleOptionActive]}
                            onPress={() => handleSelectEditRole('manager')}
                          >
                            <Text style={[styles.roleOptionText, editRole === 'manager' && styles.roleOptionTextActive]}>
                              {getRoleName('manager')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.roleOption, editRole === 'accountant' && styles.roleOptionActive]}
                            onPress={() => handleSelectEditRole('accountant')}
                          >
                            <Text style={[styles.roleOptionText, editRole === 'accountant' && styles.roleOptionTextActive]}>
                              {getRoleName('accountant')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.roleOption, editRole === 'owner' && styles.roleOptionActive]}
                            onPress={() => handleSelectEditRole('owner')}
                          >
                            <Text style={[styles.roleOptionText, editRole === 'owner' && styles.roleOptionTextActive]}>
                              {getRoleName('owner')}
                            </Text>
                          </TouchableOpacity>
                        </View>
                        {editRole === 'accountant' && (
                          <Text style={styles.accountantHint}>{t('invitations.accountantHint')}</Text>
                        )}
                        {editRole === 'owner' && editingUser?.role !== 'owner' && (
                          <Text style={styles.accountantHint}>{t('users.ownerInviteHint')}</Text>
                        )}
                        {editingUser?.role === 'owner' && editRole !== 'owner' && (
                          <Text style={styles.accountantHint}>{t('users.ownerDemoteHint')}</Text>
                        )}
                      </View>

                      {editRole !== 'owner' && (
                        <View style={styles.inputGroup}>
                          <Text style={styles.inputLabel}>{t('invitations.permissionsTitle')}</Text>
                          <Text style={styles.permissionsHint}>{t('invitations.permissionsHint')}</Text>
                          <PermissionsChecklist
                            role={editRole}
                            selected={editPermissions}
                            onToggle={toggleEditPermission}
                          />
                        </View>
                      )}

                      <TouchableOpacity
                        style={[styles.inviteButton, savingAccess && styles.buttonDisabled]}
                        onPress={handleSaveAccess}
                        disabled={savingAccess}
                      >
                        {savingAccess ? (
                          <ActivityIndicator color="white" />
                        ) : (
                          <Text style={styles.inviteButtonText}>{t('users.saveChanges')}</Text>
                        )}
                      </TouchableOpacity>
                    </>
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>

          {/* Invitation Code Modal */}
          <Modal visible={showCodeModal} animationType="fade" transparent>
            <View style={styles.modalOverlay}>
              <View style={styles.codeModalContent}>
                <Ionicons name="checkmark-circle" size={64} color={COLORS.success} />
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
                    <Ionicons name="copy" size={20} color={COLORS.primary} />
                    <Text style={styles.codeActionText}>
                      {language === 'bg' ? 'Копирай' : 'Copy'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.codeActionButton} onPress={handleShareCode}>
                    <Ionicons name="share-social" size={20} color={COLORS.primary} />
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
    borderBottomColor: COLORS.border,
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
    backgroundColor: COLORS.primary,
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
    color: COLORS.textSecondary,
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
    color: COLORS.warning,
    marginTop: 2,
  },
  invitationActions: {
    alignItems: 'flex-end',
  },
  cancelButton: {
    marginTop: 8,
  },
  ownerActionCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  ownerActionText: {
    fontSize: 14,
    color: 'white',
  },
  ownerActionProgress: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 6,
  },
  ownerActionButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  ownerActionApprove: {
    flex: 1,
    backgroundColor: COLORS.success,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  ownerActionApproveText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 13,
  },
  ownerActionReject: {
    flex: 1,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  ownerActionRejectText: {
    color: COLORS.danger,
    fontWeight: '600',
    fontSize: 13,
  },
  noAccessContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  noAccessText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalContentScrollable: {
    maxHeight: '85%',
  },
  permissionsHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 10,
  },
  editingUserName: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  editingUserEmail: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 20,
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
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: 'white',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  orText: {
    textAlign: 'center',
    color: COLORS.textMuted,
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
    backgroundColor: COLORS.background,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  roleOptionActive: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  roleOptionText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  roleOptionTextActive: {
    color: COLORS.primary,
  },
  accountantHint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 10,
    lineHeight: 17,
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
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
    backgroundColor: COLORS.surface,
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
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  codeBox: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 24,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
  },
  codeText: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.primary,
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
    color: COLORS.primary,
  },
  closeCodeButton: {
    marginTop: 24,
    padding: 16,
    paddingHorizontal: 48,
    backgroundColor: COLORS.border,
    borderRadius: 12,
  },
  closeCodeButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: 'white',
  },
});
