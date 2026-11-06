import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';

// Extracted from invoices.tsx (Module 1 audit finding #4). Full-screen
// viewer for a scanned invoice's page images, with prev/next navigation
// for a multi-page scan.
type Props = {
  pages: string[];
  pageIndex: number | null;
  onChangeIndex: React.Dispatch<React.SetStateAction<number | null>>;
};

export function ImageViewerModal({ pages, pageIndex, onChangeIndex }: Props) {
  const { t } = useTranslation();

  return (
    <Modal visible={pageIndex !== null} animationType="fade" transparent>
      <View style={styles.pageViewerOverlay}>
        <TouchableOpacity
          style={styles.pageViewerClose}
          onPress={() => onChangeIndex(null)}
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={28} color="white" />
        </TouchableOpacity>
        {pageIndex !== null && (
          <>
            <Image source={{ uri: pages[pageIndex] }} style={styles.pageViewerImage} resizeMode="contain" />
            {pages.length > 1 && (
              <View style={styles.pageViewerNav}>
                <TouchableOpacity
                  style={styles.pageViewerNavButton}
                  disabled={pageIndex === 0}
                  onPress={() => onChangeIndex((i) => (i !== null ? Math.max(0, i - 1) : i))}
                >
                  <Ionicons name="chevron-back" size={24} color={pageIndex === 0 ? COLORS.borderLight : 'white'} />
                </TouchableOpacity>
                <Text style={styles.pageViewerNavText}>{pageIndex + 1} / {pages.length}</Text>
                <TouchableOpacity
                  style={styles.pageViewerNavButton}
                  disabled={pageIndex === pages.length - 1}
                  onPress={() => onChangeIndex((i) => (i !== null ? Math.min(pages.length - 1, i + 1) : i))}
                >
                  <Ionicons name="chevron-forward" size={24} color={pageIndex === pages.length - 1 ? COLORS.borderLight : 'white'} />
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pageViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageViewerClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 1,
    padding: 8,
  },
  pageViewerImage: {
    width: '100%',
    height: '80%',
  },
  pageViewerNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    marginTop: 16,
  },
  pageViewerNavButton: {
    padding: 8,
  },
  pageViewerNavText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});
