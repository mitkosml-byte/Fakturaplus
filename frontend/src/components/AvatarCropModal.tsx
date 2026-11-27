import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Image, Text, TouchableOpacity, StyleSheet, PanResponder, useWindowDimensions } from 'react-native';
import { useTranslation } from '../i18n';
import { COLORS } from '../theme/colors';

type CropRect = { originX: number; originY: number; size: number };

type Props = {
  visible: boolean;
  imageUri: string | null;
  imageWidth: number;
  imageHeight: number;
  onCancel: () => void;
  onConfirm: (crop: CropRect) => void;
};

// Lets the user drag the picked photo to choose which square portion
// becomes the avatar, instead of it always being auto-centered. Starts
// centered (dragging is purely optional - tapping "Use" immediately gives
// the old center-crop result), and only supports panning, not zoom, to
// keep the gesture math simple: the shorter original side always maps to
// the full viewport, so only the longer axis ever has room to slide.
//
// Uses PanResponder (not react-native-gesture-handler) deliberately - see
// BottomSheet.tsx's note: GestureDetector breaks hit-testing on the web
// build, and this needs to work there too.
export function AvatarCropModal({ visible, imageUri, imageWidth, imageHeight, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const { width: screenWidth } = useWindowDimensions();
  const viewport = Math.min(screenWidth - 64, 320);

  const { displayScale, displayedWidth, displayedHeight, maxOffsetX, maxOffsetY } = useMemo(() => {
    const shortSide = Math.max(1, Math.min(imageWidth, imageHeight));
    const scale = viewport / shortSide;
    const dw = imageWidth * scale;
    const dh = imageHeight * scale;
    return {
      displayScale: scale,
      displayedWidth: dw,
      displayedHeight: dh,
      maxOffsetX: Math.max(0, dw - viewport),
      maxOffsetY: Math.max(0, dh - viewport),
    };
  }, [imageWidth, imageHeight, viewport]);

  // Image's own top-left position relative to the viewport's top-left -
  // always <= 0, and never lets the viewport see past the image's edges.
  const [pos, setPos] = useState({ x: -maxOffsetX / 2, y: -maxOffsetY / 2 });
  const dragStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    // Re-center whenever a new photo is loaded.
    setPos({ x: -maxOffsetX / 2, y: -maxOffsetY / 2 });
  }, [imageUri, maxOffsetX, maxOffsetY]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
      onPanResponderGrant: () => {
        dragStart.current = pos;
      },
      onPanResponderMove: (_evt, gesture) => {
        const nextX = Math.min(0, Math.max(-maxOffsetX, dragStart.current.x + gesture.dx));
        const nextY = Math.min(0, Math.max(-maxOffsetY, dragStart.current.y + gesture.dy));
        setPos({ x: nextX, y: nextY });
      },
    })
  ).current;

  const handleConfirm = () => {
    const shortSide = Math.min(imageWidth, imageHeight);
    const originX = Math.round(Math.min(Math.max(-pos.x / displayScale, 0), imageWidth - shortSide));
    const originY = Math.round(Math.min(Math.max(-pos.y / displayScale, 0), imageHeight - shortSide));
    onConfirm({ originX, originY, size: shortSide });
  };

  if (!imageUri) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('profile.cropTitle')}</Text>
          <Text style={styles.hint}>{t('profile.cropHint')}</Text>

          <View style={[styles.viewport, { width: viewport, height: viewport }]} {...panResponder.panHandlers}>
            <Image
              source={{ uri: imageUri }}
              style={{ position: 'absolute', left: pos.x, top: pos.y, width: displayedWidth, height: displayedHeight }}
              resizeMode="stretch"
            />
            <View pointerEvents="none" style={[styles.circleGuide, { width: viewport, height: viewport, borderRadius: viewport / 2 }]} />
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm}>
              <Text style={styles.confirmButtonText}>{t('profile.cropUse')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.8)', justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 20, alignItems: 'center' },
  title: { fontSize: 17, fontWeight: 'bold', color: 'white', marginBottom: 4 },
  hint: { fontSize: 12, color: COLORS.textMuted, marginBottom: 16, textAlign: 'center' },
  viewport: {
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: COLORS.background,
  },
  circleGuide: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.85)',
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelButton: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, backgroundColor: COLORS.background },
  cancelButtonText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  confirmButton: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, backgroundColor: COLORS.primary },
  confirmButtonText: { color: 'white', fontSize: 14, fontWeight: '700' },
});
