import { Platform } from 'react-native';
import { api } from '../services/api';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export class NotLoggedInError extends Error {}
export class DownloadFailedError extends Error {}

// Downloads a file from an authenticated backend endpoint (Bearer token) and
// saves/shares it. Unlike opening the raw export URL directly
// (window.open/Linking.openURL), this always sends the session token itself
// rather than relying on a browser-attached cookie - the cookie approach
// silently breaks on native (Linking.openURL opens the system browser, which
// shares no cookies with the app) and, on web, means the request's real auth
// depends on the SameSite=None session cookie rather than the token the rest
// of the app uses everywhere else.
export async function downloadAndShareFile(endpoint: string, filename: string): Promise<{ shared: boolean }> {
  const token = api.getToken();
  if (!token) {
    throw new NotLoggedInError();
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new DownloadFailedError();
  }

  const blob = await response.blob();

  if (Platform.OS === 'web') {
    // expo-file-system/expo-sharing have no real backing on web; the
    // standard way to save a fetched blob there is an object URL fed
    // through a temporary <a download> link.
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
    return { shared: false };
  }

  const base64data: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const base64 = base64data.split(',')[1];

  // The top-level "expo-file-system" export is SDK 54's new File/Directory
  // API, which no longer includes documentDirectory/writeAsStringAsync -
  // those now live under the legacy subpath.
  const FileSystem = require('expo-file-system/legacy');
  const Sharing = require('expo-sharing');

  const fileUri = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const shared = await Sharing.isAvailableAsync();
  if (shared) {
    await Sharing.shareAsync(fileUri);
  }

  return { shared };
}
