import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { formatDistanceToNow } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { api } from '../src/services/api';
import { ConversationSummary, CollabMember } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied } from '../src/components';
import { getPushStatus } from '../src/utils/pushNotifications';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const POLL_INTERVAL_MS = 15000;

export default function MessagesScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const { hasPermission, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [pushHintVisible, setPushHintVisible] = useState(false);

  const [pickerVisible, setPickerVisible] = useState(false);
  const [members, setMembers] = useState<CollabMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const data = await api.getConversations();
      setConversations(data);
    } catch (error: any) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadConversations();
      getPushStatus().then((status) => setPushHintVisible(status === 'default'));
      intervalRef.current = setInterval(loadConversations, POLL_INTERVAL_MS);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }, [loadConversations])
  );

  const openThread = (conv: ConversationSummary) => {
    router.push({
      pathname: '/message-thread',
      params: { conversationId: conv.conversation_id, title: conv.name },
    });
  };

  const openPicker = async () => {
    setPickerVisible(true);
    setMembersLoading(true);
    try {
      const data = await api.getCollabMembers();
      setMembers(data.filter((m) => m.user_id !== user?.user_id));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setMembersLoading(false);
    }
  };

  const startDm = async (member: CollabMember) => {
    try {
      const { conversation_id } = await api.startDirectMessage(member.user_id);
      setPickerVisible(false);
      router.push({ pathname: '/message-thread', params: { conversationId: conversation_id, title: member.name } });
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    }
  };

  if (!hasPermission('team_collaboration')) {
    return <AccessDenied />;
  }

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('messages.title')}</Text>
            <TouchableOpacity onPress={openPicker} style={styles.backButton} accessibilityLabel={t('messages.newDm')}>
              <Ionicons name="person-add" size={20} color="white" />
            </TouchableOpacity>
          </View>

          {pushHintVisible && (
            <TouchableOpacity style={styles.pushBanner} onPress={() => router.push('/notifications-settings')}>
              <Ionicons name="notifications-outline" size={18} color="#8B5CF6" />
              <Text style={styles.pushBannerText}>{t('messages.enablePushHint')}</Text>
              <Ionicons name="chevron-forward" size={16} color="#8B5CF6" />
            </TouchableOpacity>
          )}

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#8B5CF6" />
            </View>
          ) : (
            <FlatList
              data={conversations}
              keyExtractor={(item) => item.conversation_id}
              contentContainerStyle={{ padding: 16 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.conversationRow} onPress={() => openThread(item)}>
                  <View style={styles.avatar}>
                    <Ionicons name={item.conversation_id.startsWith('team:') ? 'people' : 'person'} size={22} color="#8B5CF6" />
                  </View>
                  <View style={styles.conversationInfo}>
                    <View style={styles.conversationTopRow}>
                      <Text style={styles.conversationName} numberOfLines={1}>{item.name}</Text>
                      {item.last_message_at && (
                        <Text style={styles.conversationTime}>
                          {formatDistanceToNow(new Date(item.last_message_at), { locale: dateLocale, addSuffix: false })}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.conversationPreview} numberOfLines={1}>
                      {item.last_message || t('messages.noMessagesYet')}
                    </Text>
                  </View>
                  {item.unread_count > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="chatbubbles-outline" size={64} color="#334155" />
                  <Text style={styles.emptyText}>{t('messages.noConversations')}</Text>
                </View>
              }
            />
          )}

          <Modal visible={pickerVisible} animationType="fade" transparent onRequestClose={() => setPickerVisible(false)}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>{t('messages.newDm')}</Text>
                {membersLoading ? (
                  <ActivityIndicator color="#8B5CF6" />
                ) : (
                  <FlatList
                    data={members}
                    keyExtractor={(m) => m.user_id}
                    style={{ maxHeight: 320 }}
                    renderItem={({ item }) => (
                      <TouchableOpacity style={styles.memberRow} onPress={() => startDm(item)}>
                        <View style={styles.avatar}>
                          <Ionicons name="person" size={18} color="#8B5CF6" />
                        </View>
                        <Text style={styles.memberName}>{item.name}</Text>
                      </TouchableOpacity>
                    )}
                    ListEmptyComponent={<Text style={styles.emptyText}>{t('messages.noMembers')}</Text>}
                  />
                )}
                <TouchableOpacity style={styles.cancelButton} onPress={() => setPickerVisible(false)}>
                  <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
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
  backgroundImage: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)' },
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 18, fontWeight: 'bold', color: 'white' },
  pushBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pushBannerText: { flex: 1, fontSize: 13, color: '#C4B5FD', fontWeight: '500' },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 16, color: '#64748B', marginTop: 16 },
  conversationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  conversationInfo: { flex: 1 },
  conversationTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  conversationName: { fontSize: 15, fontWeight: '600', color: 'white', flex: 1, marginRight: 8 },
  conversationTime: { fontSize: 11, color: '#64748B' },
  conversationPreview: { fontSize: 13, color: '#94A3B8', marginTop: 2 },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: 'white', marginBottom: 16 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  memberName: { fontSize: 15, color: 'white' },
  cancelButton: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
  cancelButtonText: { color: '#94A3B8', fontSize: 14 },
});
