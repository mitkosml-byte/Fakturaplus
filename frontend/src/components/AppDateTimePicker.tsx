// Native (iOS/Android) build: react-native-modal-datetime-picker's own
// native pickers work fine there, so just pass through unchanged. The web
// build instead resolves AppDateTimePicker.web.tsx - that library (and its
// @react-native-community/datetimepicker dependency) renders nothing at all
// on web, so every date/time picker in the app would silently fail to open.
import DateTimePickerModal from 'react-native-modal-datetime-picker';

export default DateTimePickerModal;
