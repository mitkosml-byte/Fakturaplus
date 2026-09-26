import { Alert as RNAlert, Platform } from 'react-native';

type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

// react-native-web does not implement Alert.alert (it silently no-ops), so
// errors and confirmations never appear to the user on web. This wraps the
// native Alert on native platforms and falls back to window.alert/confirm
// on web, keeping the same call signature everywhere.
function alert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== 'web') {
    RNAlert.alert(title, message, buttons as any);
    return;
  }

  const text = [title, message].filter(Boolean).join('\n\n');
  const hasCancel = buttons?.some((b) => b.style === 'cancel');

  if (buttons && buttons.length > 1 && hasCancel) {
    const confirmButton = buttons.find((b) => b.style !== 'cancel');
    const cancelButton = buttons.find((b) => b.style === 'cancel');
    if (window.confirm(text)) {
      confirmButton?.onPress?.();
    } else {
      cancelButton?.onPress?.();
    }
    return;
  }

  window.alert(text);
  buttons?.[0]?.onPress?.();
}

export const Alert = { alert };
