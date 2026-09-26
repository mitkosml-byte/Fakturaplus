import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { format } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { api } from '../src/services/api';
import { Message } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied } from '../src/components';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const POLL_INTERVAL_MS = 4000;

export default function MessageThreadScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId: string; title?: string }>();
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();

  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const listRef = useRef<FlatList<Message>>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const conversationId = params.conversationId;

  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const data = await api.getMessages(conversationId);
      setMessages(data);
    } catch (error: any) {
      console.error('Error loading messages:', error);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useFocusEffect(
    useCallback(() => {
      loadMessages();
      api.markConversationRead(conversationId).catch(() => {});
      intervalRef.current = setInterval(() => {
        loadMessages();
        api.markConversationRead(conversationId).catch(() => {});
      }, POLL_INTERVAL_MS);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }, [loadMessages, conversationId])
  );

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    try {
      const sent = await api.sendMessage(conversationId, trimmed);
      setMessages((prev) => [...prev, sent]);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
      setText(trimmed);
    } finally {
      setSending(false);
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
            <Text style={styles.title} numberOfLines={1}>{params.title || t('messages.title')}</Text>
            <View style={{ width: 40 }} />
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
            keyboardVerticalOffset={0}
          >
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#8B5CF6" />
              </View>
            ) : (
              <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ padding: 16 }}
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
                renderItem={({ item }) => {
                  const isMine = item.sender_id === user?.user_id;
                  return (
                    <View style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                      <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                        {!isMine && <Text style={styles.bubbleSender}>{item.sender_name}</Text>}
                        <Text style={styles.bubbleText}>{item.text}</Text>
                        <Text style={styles.bubbleTime}>{format(new Date(item.created_at), 'HH:mm')}</Text>
                      </View>
                    </View>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>{t('messages.noMessagesYet')}</Text>
                  </View>
                }
              />
            )}

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder={t('messages.typeMessage')}
                placeholderTextColor="#64748B"
                multiline
                onSubmitEditing={handleSend}
              />
              <TouchableOpacity style={styles.sendButton} onPress={handleSend} disabled={sending || !text.trim()}>
                {sending ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="send" size={20} color="white" />}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
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
  title: { fontSize: 18, fontWeight: 'bold', color: 'white', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: '#64748B' },
  bubbleRow: { flexDirection: 'row', marginBottom: 10 },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '78%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMine: { backgroundColor: '#8B5CF6', borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#1E293B', borderBottomLeftRadius: 4 },
  bubbleSender: { fontSize: 11, fontWeight: '700', color: '#C4B5FD', marginBottom: 2 },
  bubbleText: { fontSize: 15, color: 'white' },
  bubbleTime: { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 4, alignSelf: 'flex-end' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  input: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: 'white',
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
