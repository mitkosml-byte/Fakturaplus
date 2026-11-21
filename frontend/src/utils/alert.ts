import { Alert as RNAlert, Platform } from 'react-native';
import { create } from 'zustand';

export type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

export type AlertDialog = {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
};

// The dialogs waiting on the web, shown one at a time by AlertHost.
interface AlertQueue {
  queue: AlertDialog[];
  push: (dialog: AlertDialog) => void;
  shift: () => void;
}

export const useAlertQueue = create<AlertQueue>((set) => ({
  queue: [],
  push: (dialog) => set((state) => ({ queue: [...state.queue, dialog] })),
  shift: () => set((state) => ({ queue: state.queue.slice(1) })),
}));

let nextId = 0;

// react-native-web does not implement Alert.alert. The browser's own
// confirm/alert offer only OK and Cancel, so a question with two answers
// (or three) lost all but one of them. On the web the app shows its own
// dialog with every button (AlertHost, mounted once at the root); on a
// phone the system's alert, as before. Same call everywhere.
function alert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== 'web') {
    RNAlert.alert(title, message, buttons as any);
    return;
  }
  useAlertQueue.getState().push({
    id: ++nextId,
    title,
    message,
    buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }],
  });
}

export const Alert = { alert };
