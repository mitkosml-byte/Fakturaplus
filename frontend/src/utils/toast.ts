import { useToastStore } from '../stores/toastStore';
import { translations, useLanguageStore } from '../i18n';

const DEFAULT_DURATION = 2500;
const UNDO_DURATION = 4000;

// Toast is called imperatively from anywhere (api handlers, screens) the
// same way the existing `Alert` utility is - no hook, no provider prop
// drilling. It can't use the useTranslation() hook (not a component), so
// it reads the language store directly, mirroring what that hook does.
function t(key: string): string {
  const language = useLanguageStore.getState().language;
  const translation = translations[key];
  if (!translation) return key;
  return translation[language] || translation.bg || key;
}

export const Toast = {
  // Routine success/info feedback - Motion Design System #4. Replaces
  // Alert.alert for anything that isn't a destructive confirmation.
  success(message: string) {
    useToastStore.getState().show({ message, variant: 'success', duration: DEFAULT_DURATION });
  },
  info(message: string) {
    useToastStore.getState().show({ message, variant: 'info', duration: DEFAULT_DURATION });
  },
  // Sharpened #19: used by immediate-delete flows instead of a blocking
  // confirm dialog - the row is already gone, this is the undo window.
  undo(message: string, onUndo: () => void, duration = UNDO_DURATION) {
    useToastStore.getState().show({
      message,
      variant: 'undo',
      actionLabel: t('common.undo'),
      onAction: onUndo,
      duration,
    });
  },
};
