import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Phone cameras capture at 3000-4000px+ on the long edge - Claude's
// vision pricing is per-pixel-patch (28x28px = 1 token), and a photo that
// size already hits the model's own 2576px/4784-token cap on every page,
// which is close to the single biggest cost component of a scan. OCR only
// needs the text to be legible, not photographic fidelity, so downscaling
// here before upload cuts that cost roughly in half with (expected, not
// yet measured in production) no loss of extraction accuracy.
// TARGET_LONG_EDGE is deliberately conservative; lower it further only
// after confirming OCR quality holds on real invoices. One helper for
// every scan: invoices (the scan screen) and the till's daily report.
const TARGET_LONG_EDGE = 1600;

export async function prepareScanImage(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const longEdge = Math.max(asset.width, asset.height);
  if (longEdge <= TARGET_LONG_EDGE) {
    return `data:image/jpeg;base64,${asset.base64}`;
  }
  const resized = asset.width >= asset.height ? { width: TARGET_LONG_EDGE } : { height: TARGET_LONG_EDGE };
  const rendered = await ImageManipulator.manipulate(asset.uri).resize(resized).renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.85, format: SaveFormat.JPEG, base64: true });
  return `data:image/jpeg;base64,${saved.base64}`;
}

// A photo from the camera or the gallery, ready to send; null if none.
export async function pickScanImage(source: 'camera' | 'library'): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    base64: true,
    quality: 1,
  };
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]?.base64) return null;
  return prepareScanImage(result.assets[0]);
}
