import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Modal, ActivityIndicator, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, Locale } from 'date-fns';
import DateTimePickerModal from '../AppDateTimePicker';
import { PressableScale } from '..';
import { useTranslation } from '../../i18n';
import { Invoice, VatTreatment } from '../../types';
import { Avatar } from '../Avatar';
import { COLORS } from '../../theme/colors';

// Extracted from invoices.tsx (Module 1 audit finding #4). The single
// largest remaining modal on this screen - view/edit for one invoice,
// including its payment status and scanned-page thumbnails. Deliberately
// deferred past the rest of Phase 5c's invoices.tsx pass because of its
// size and the number of interconnected edit-form fields; extracted now
// as its own follow-up.
const VAT_TREATMENT_OPTIONS: VatTreatment[] = [
  'standard_20', 'reduced_9', 'zero_rate', 'exempt', 'reverse_charge', 'outside_scope',
];

type Props = {
  invoice: Invoice | null;
  // Who scanned/created this invoice - resolved by the parent screen from
  // the company directory (invoice.user_id isn't a name/picture by
  // itself). Undefined while that lookup is still loading, or if the
  // creator no longer resolves to a known company member.
  scannedBy?: { name: string; picture: string | null };
  onClose: () => void;
  editMode: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  dateLocale: Locale;
  language: string;

  editSupplier: string;
  onChangeSupplier: (v: string) => void;
  editSupplierEik: string;
  onChangeSupplierEik: (v: string) => void;
  editInvoiceNumber: string;
  onChangeInvoiceNumber: (v: string) => void;
  editDate: Date;
  onChangeEditDate: (d: Date) => void;
  isEditDatePickerVisible: boolean;
  onOpenEditDatePicker: () => void;
  onCloseEditDatePicker: () => void;
  editAmountWithoutVat: string;
  onChangeAmountWithoutVat: (v: string) => void;
  editVatAmount: string;
  onChangeVatAmount: (v: string) => void;
  editVatTreatment: VatTreatment | '';
  onChangeVatTreatment: (v: VatTreatment) => void;
  editNotes: string;
  onChangeNotes: (v: string) => void;
  savingEdit: boolean;
  onSaveEdit: () => void;

  selectedInvoiceAlerts: any[];
  loadingInvoiceAlerts: boolean;
  updatingPayment: boolean;
  onTogglePaid: (invoice: Invoice) => void;
  onOpenPaymentModal: (invoice: Invoice) => void;

  scannedPages: string[];
  loadingScannedPages: boolean;
  onViewPage: (index: number) => void;

  onDelete: (id: string) => void;
};

export function InvoiceDetailModal({
  invoice, scannedBy, onClose, editMode, onStartEdit, onCancelEdit, dateLocale, language,
  editSupplier, onChangeSupplier, editSupplierEik, onChangeSupplierEik,
  editInvoiceNumber, onChangeInvoiceNumber, editDate, onChangeEditDate,
  isEditDatePickerVisible, onOpenEditDatePicker, onCloseEditDatePicker,
  editAmountWithoutVat, onChangeAmountWithoutVat, editVatAmount, onChangeVatAmount,
  editVatTreatment, onChangeVatTreatment, editNotes, onChangeNotes, savingEdit, onSaveEdit,
  selectedInvoiceAlerts, loadingInvoiceAlerts, updatingPayment, onTogglePaid, onOpenPaymentModal,
  scannedPages, loadingScannedPages, onViewPage, onDelete,
}: Props) {
  const { t } = useTranslation();

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'd MMM yyyy', { locale: dateLocale });
    } catch {
      return dateStr;
    }
  };

  return (
    <Modal visible={!!invoice} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.detailModalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{editMode ? t('invoices.editInvoice') : t('invoices.details')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              {!editMode && invoice && (
                <TouchableOpacity onPress={onStartEdit} accessibilityLabel={t('invoices.editInvoice')}>
                  <Ionicons name="pencil" size={22} color={COLORS.primary} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => (editMode ? onCancelEdit() : onClose())}>
                <Ionicons name="close" size={28} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {invoice && editMode && (
            <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('invoices.supplier')} *</Text>
                <TextInput
                  style={styles.input}
                  value={editSupplier}
                  onChangeText={onChangeSupplier}
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('scan.supplierEik')}</Text>
                <TextInput
                  style={styles.input}
                  value={editSupplierEik}
                  onChangeText={onChangeSupplierEik}
                  keyboardType="number-pad"
                  placeholder="131071587"
                  placeholderTextColor={COLORS.textMuted}
                  maxLength={13}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('invoices.invoiceNo')} *</Text>
                <TextInput
                  style={styles.input}
                  value={editInvoiceNumber}
                  onChangeText={onChangeInvoiceNumber}
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('invoices.dateLabel')} *</Text>
                <TouchableOpacity style={styles.dateInputButton} onPress={onOpenEditDatePicker}>
                  <Ionicons name="calendar" size={20} color={COLORS.primary} />
                  <Text style={styles.dateInputText}>
                    {format(editDate, 'd MMMM yyyy', { locale: dateLocale })}
                  </Text>
                  <Ionicons name="chevron-down" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
              <DateTimePickerModal
                isVisible={isEditDatePickerVisible}
                mode="date"
                date={editDate}
                onConfirm={(d: Date) => { onChangeEditDate(d); onCloseEditDatePicker(); }}
                onCancel={onCloseEditDatePicker}
                confirmTextIOS={t('common.select')}
                cancelTextIOS={t('common.cancel')}
                locale={language}
              />

              <View style={styles.detailRow2}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>{t('invoices.withoutVAT')}</Text>
                  <TextInput
                    style={styles.input}
                    value={editAmountWithoutVat}
                    onChangeText={onChangeAmountWithoutVat}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>{t('scan.vatAmount')}</Text>
                  <TextInput
                    style={styles.input}
                    value={editVatAmount}
                    onChangeText={onChangeVatAmount}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>
              </View>

              <View style={styles.totalSection}>
                <Text style={styles.totalSectionLabel}>{t('invoices.totalAmount')}</Text>
                <Text style={styles.totalSectionValue}>
                  {((parseFloat(editAmountWithoutVat.replace(',', '.')) || 0) + (parseFloat(editVatAmount.replace(',', '.')) || 0)).toFixed(2)} €
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('scan.vatTreatment')}</Text>
                <View style={styles.vatTreatmentGrid}>
                  {VAT_TREATMENT_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option}
                      style={[styles.vatTreatmentChip, editVatTreatment === option && styles.vatTreatmentChipActive]}
                      onPress={() => onChangeVatTreatment(option)}
                    >
                      <Text style={[styles.vatTreatmentChipText, editVatTreatment === option && styles.vatTreatmentChipTextActive]}>
                        {t(`vat.${option}`)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('invoices.notes')}</Text>
                <TextInput
                  style={[styles.input, { minHeight: 70 }]}
                  value={editNotes}
                  onChangeText={onChangeNotes}
                  multiline
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>

              <View style={styles.editActionsRow}>
                <TouchableOpacity style={styles.editCancelButton} onPress={onCancelEdit} disabled={savingEdit}>
                  <Text style={styles.editCancelButtonText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <PressableScale style={[styles.submitButton, { flex: 1 }]} onPress={onSaveEdit} disabled={savingEdit}>
                  {savingEdit ? <ActivityIndicator color="white" /> : <Text style={styles.submitButtonText}>{t('common.save')}</Text>}
                </PressableScale>
              </View>
            </ScrollView>
          )}

          {invoice && !editMode && (
            <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionLabel}>{t('invoices.supplier')}</Text>
                <Text style={styles.detailSectionValue}>{invoice.supplier}</Text>
              </View>
              {invoice.supplier_eik && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>{t('scan.supplierEik')}</Text>
                  <Text style={styles.detailSectionValue}>{invoice.supplier_eik}</Text>
                </View>
              )}
              {invoice.vat_treatment && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>{t('scan.vatTreatment')}</Text>
                  <Text style={styles.detailSectionValue}>{t(`vat.${invoice.vat_treatment}`)}</Text>
                </View>
              )}
              {invoice.vat_treatment === 'reverse_charge' && (() => {
                const deadline = new Date(new Date(invoice.date).getTime() + 15 * 24 * 60 * 60 * 1000);
                const overdue = deadline.getTime() < Date.now();
                return (
                  <View style={[styles.protocolBanner, overdue && styles.protocolBannerOverdue]}>
                    <Ionicons name={overdue ? 'alert-circle' : 'document-text'} size={18} color={overdue ? COLORS.danger : COLORS.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.protocolBannerTitle}>
                        {t('scan.protocolAssigned')} {invoice.protocol_number || '—'}
                      </Text>
                      <Text style={[styles.protocolBannerDeadline, overdue && { color: COLORS.danger }]}>
                        {t('invoices.protocolDeadline')}: {formatDate(deadline.toISOString())}
                        {overdue ? ` (${t('invoices.protocolOverdue')})` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })()}
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionLabel}>{t('invoices.invoiceNo')}</Text>
                <Text style={styles.detailSectionValue}>{invoice.invoice_number}</Text>
              </View>
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionLabel}>{t('invoices.dateLabel')}</Text>
                <Text style={styles.detailSectionValue}>{formatDate(invoice.date)}</Text>
              </View>
              {scannedBy && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>{t('invoices.scannedBy')}</Text>
                  <View style={styles.scannedByRow}>
                    <Avatar uri={scannedBy.picture} name={scannedBy.name} size={20} />
                    <Text style={styles.detailSectionValue}>{scannedBy.name}</Text>
                  </View>
                </View>
              )}
              <View style={styles.detailRow2}>
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>{t('invoices.withoutVAT')}</Text>
                  <Text style={styles.detailSectionValue}>{invoice.amount_without_vat.toFixed(2)} €</Text>
                </View>
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>{t('invoices.vatPercent')}</Text>
                  <Text style={styles.detailSectionValue}>{invoice.vat_amount.toFixed(2)} €</Text>
                </View>
              </View>
              <View style={styles.totalSection}>
                <Text style={styles.totalSectionLabel}>{t('invoices.totalAmount')}</Text>
                <Text style={styles.totalSectionValue}>{invoice.total_amount.toFixed(2)} €</Text>
              </View>

              {invoice.payment_method && (() => {
                const overdue = !invoice.is_paid && !!invoice.payment_due_date
                  && new Date(invoice.payment_due_date).getTime() < Date.now();
                return (
                  <View style={[styles.paymentSection, overdue && styles.paymentSectionOverdue]}>
                    <View style={styles.paymentSectionHeader}>
                      <Text style={styles.detailSectionLabel}>{t('invoices.paymentSection')}</Text>
                      <Text style={styles.paymentMethodTag}>
                        {invoice.payment_method === 'cash'
                          ? t('invoices.paymentMethodCash')
                          : t('invoices.paymentMethodBankTransfer')}
                      </Text>
                    </View>

                    {invoice.payment_method === 'bank_transfer' && (
                      <>
                        {invoice.payment_due_date && !invoice.is_paid && (
                          <Text style={[styles.paymentDueText, overdue && { color: COLORS.danger }]}>
                            {overdue ? t('invoices.overdueSince') : t('invoices.paymentDueDate')}: {formatDate(invoice.payment_due_date)}
                          </Text>
                        )}

                        {!invoice.is_paid && invoice.paid_amount > 0 && (
                          <View style={styles.paymentProgressBox}>
                            <Text style={styles.paymentProgressText}>
                              {t('invoices.paidOfTotal')
                                .replace('{paid}', invoice.paid_amount.toFixed(2))
                                .replace('{total}', invoice.total_amount.toFixed(2))}
                            </Text>
                            <Text style={styles.paymentRemainingText}>
                              {t('invoices.remainingAmount')}: {(invoice.total_amount - invoice.paid_amount).toFixed(2)} €
                            </Text>
                            <View style={styles.paymentProgressBar}>
                              <View style={[
                                styles.paymentProgressBarFill,
                                { width: `${Math.min(100, (invoice.paid_amount / invoice.total_amount) * 100)}%` }
                              ]} />
                            </View>
                          </View>
                        )}

                        <TouchableOpacity
                          style={styles.paidCheckboxRow}
                          onPress={() => onTogglePaid(invoice)}
                          disabled={updatingPayment}
                        >
                          <View style={[styles.checkbox, invoice.is_paid && styles.checkboxChecked]}>
                            {invoice.is_paid && <Ionicons name="checkmark" size={16} color="white" />}
                          </View>
                          <Text style={styles.paidCheckboxLabel}>
                            {invoice.is_paid && invoice.paid_at
                              ? `${t('invoices.paidOn')} ${formatDate(invoice.paid_at)}`
                              : t('invoices.markFullyPaid')}
                          </Text>
                          {updatingPayment && <ActivityIndicator size="small" color={COLORS.primary} />}
                        </TouchableOpacity>

                        {!invoice.is_paid && (
                          <TouchableOpacity
                            style={styles.recordPaymentButton}
                            onPress={() => onOpenPaymentModal(invoice)}
                            disabled={updatingPayment}
                          >
                            <Ionicons name="cash-outline" size={16} color={COLORS.primary} />
                            <Text style={styles.recordPaymentButtonText}>
                              {invoice.paid_amount > 0 ? t('invoices.editPayment') : t('invoices.recordPayment')}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </>
                    )}
                  </View>
                );
              })()}

              {invoice.items && invoice.items.length > 0 && (() => {
                const items = invoice.items!;
                const itemsSum = items.reduce(
                  (sum, it) => sum + (it.total_price ?? (it.quantity || 0) * it.unit_price),
                  0
                );
                const mismatch = Math.abs(itemsSum - invoice.amount_without_vat) > 0.05;
                return (
                  <View style={styles.itemsSection}>
                    <View style={styles.itemsSectionHeader}>
                      <Text style={styles.detailSectionLabel}>{t('invoices.items')}</Text>
                      {loadingInvoiceAlerts && <ActivityIndicator size="small" color={COLORS.textMuted} />}
                    </View>

                    <View style={styles.itemsTableHeader}>
                      <Text style={[styles.itemsTableHeaderText, { flex: 2 }]}>{t('invoices.itemName')}</Text>
                      <Text style={[styles.itemsTableHeaderText, styles.itemsColRight, { flex: 1 }]}>{t('invoices.itemQty')}</Text>
                      <Text style={[styles.itemsTableHeaderText, styles.itemsColRight, { flex: 1 }]}>{t('invoices.itemUnitPrice')}</Text>
                      <Text style={[styles.itemsTableHeaderText, styles.itemsColRight, { flex: 1 }]}>{t('invoices.itemTotal')}</Text>
                    </View>

                    {items.map((item, index) => {
                      const alert = selectedInvoiceAlerts.find((a) => a.item_name === item.name);
                      const lineTotal = item.total_price ?? (item.quantity || 0) * item.unit_price;
                      return (
                        <View key={index} style={styles.itemRow}>
                          <View style={{ flex: 2 }}>
                            <Text style={styles.itemRowName} numberOfLines={2}>{item.name}</Text>
                            {alert && (
                              <View style={[
                                styles.itemPriceAlertBadge,
                                alert.direction === 'decrease' && styles.itemPriceAlertBadgeDecrease,
                              ]}>
                                <Ionicons
                                  name={alert.direction === 'decrease' ? 'trending-down' : 'trending-up'}
                                  size={11}
                                  color={alert.direction === 'decrease' ? COLORS.success : COLORS.danger}
                                />
                                <Text style={[
                                  styles.itemPriceAlertText,
                                  alert.direction === 'decrease' && styles.itemPriceAlertTextDecrease,
                                ]}>
                                  {alert.change_percent > 0 ? '+' : ''}{alert.change_percent}%{' '}
                                  {(alert.baseline_purchase_count || 1) > 1
                                    ? t('invoices.vsBaseline').replace('{count}', String(alert.baseline_purchase_count))
                                    : t('invoices.vsBaselineSingle')}
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text style={[styles.itemRowValue, styles.itemsColRight, { flex: 1 }]}>
                            {item.quantity} {item.unit}
                          </Text>
                          <Text style={[styles.itemRowValue, styles.itemsColRight, { flex: 1 }]}>
                            {item.unit_price.toFixed(2)}€
                          </Text>
                          <Text style={[styles.itemRowValue, styles.itemsColRight, styles.itemRowTotal, { flex: 1 }]}>
                            {lineTotal.toFixed(2)}€
                          </Text>
                        </View>
                      );
                    })}

                    <View style={styles.itemsSumRow}>
                      <Text style={styles.itemsSumLabel}>{t('invoices.itemsSum')}</Text>
                      <Text style={styles.itemsSumValue}>{itemsSum.toFixed(2)} €</Text>
                    </View>
                    {mismatch && (
                      <View style={styles.itemsMismatchNote}>
                        <Ionicons name="alert-circle-outline" size={14} color={COLORS.warning} />
                        <Text style={styles.itemsMismatchText}>{t('invoices.itemsMismatch')}</Text>
                      </View>
                    )}
                  </View>
                );
              })()}

              {(loadingScannedPages || scannedPages.length > 0) && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>{t('invoices.scannedPages')}</Text>
                  {loadingScannedPages ? (
                    <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginTop: 8 }} />
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                      {scannedPages.map((uri, index) => (
                        <TouchableOpacity
                          key={index}
                          style={styles.scannedPageThumbWrapper}
                          onPress={() => onViewPage(index)}
                        >
                          <Image source={{ uri }} style={styles.scannedPageThumb} resizeMode="cover" />
                          {scannedPages.length > 1 && (
                            <View style={styles.scannedPageBadge}>
                              <Text style={styles.scannedPageBadgeText}>{index + 1}</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>
              )}

              {invoice.notes && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>{t('invoices.notes')}</Text>
                  <Text style={styles.detailSectionValue}>{invoice.notes}</Text>
                </View>
              )}

              <PressableScale
                style={styles.deleteButton}
                onPress={() => {
                  onClose();
                  onDelete(invoice.id);
                }}
              >
                <Ionicons name="trash" size={20} color={COLORS.danger} />
                <Text style={styles.deleteButtonText}>{t('invoices.deleteInvoice')}</Text>
              </PressableScale>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  detailModalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '90%',
  },
  detailScroll: {
    maxHeight: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: 'white',
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  dateInputButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  dateInputText: {
    flex: 1,
    color: 'white',
    fontSize: 16,
  },
  vatTreatmentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  vatTreatmentChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  vatTreatmentChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  vatTreatmentChipText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  vatTreatmentChipTextActive: {
    color: 'white',
  },
  editActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    marginBottom: 16,
  },
  editCancelButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: COLORS.border,
  },
  editCancelButtonText: {
    color: COLORS.textLight,
    fontSize: 16,
    fontWeight: '600',
  },
  detailSection: {
    marginBottom: 16,
  },
  scannedPageThumbWrapper: {
    marginRight: 10,
    position: 'relative',
  },
  scannedPageThumb: {
    width: 72,
    height: 96,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  scannedPageBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  scannedPageBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '700',
  },
  protocolBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  protocolBannerOverdue: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  protocolBannerTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: 'white',
  },
  protocolBannerDeadline: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  detailSectionLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  detailSectionValue: {
    fontSize: 16,
    color: 'white',
  },
  scannedByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailRow2: {
    flexDirection: 'row',
    gap: 16,
  },
  totalSection: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  totalSectionLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  totalSectionValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  paymentSection: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  paymentSectionOverdue: {
    borderColor: COLORS.danger,
  },
  paymentSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  paymentMethodTag: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  paymentDueText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 10,
  },
  paidCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.textMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  paidCheckboxLabel: {
    fontSize: 14,
    color: 'white',
    flex: 1,
  },
  paymentProgressBox: {
    marginBottom: 10,
  },
  paymentProgressText: {
    fontSize: 13,
    color: 'white',
    fontWeight: '600',
  },
  paymentRemainingText: {
    fontSize: 12,
    color: COLORS.warning,
    marginTop: 2,
    marginBottom: 6,
  },
  paymentProgressBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.border,
    overflow: 'hidden',
  },
  paymentProgressBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  recordPaymentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  recordPaymentButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  itemsSection: {
    marginBottom: 16,
  },
  itemsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  itemsTableHeader: {
    flexDirection: 'row',
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 4,
  },
  itemsTableHeaderText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  itemsColRight: {
    textAlign: 'right',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
    gap: 4,
  },
  itemRowName: {
    fontSize: 13,
    color: 'white',
    fontWeight: '500',
  },
  itemRowValue: {
    fontSize: 13,
    color: COLORS.textSubtle,
  },
  itemRowTotal: {
    fontWeight: '600',
    color: 'white',
  },
  itemPriceAlertBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 3,
  },
  itemPriceAlertText: {
    fontSize: 10,
    color: COLORS.danger,
    fontWeight: '600',
  },
  itemPriceAlertBadgeDecrease: {},
  itemPriceAlertTextDecrease: {
    color: COLORS.success,
  },
  itemsSumRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingHorizontal: 4,
  },
  itemsSumLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  itemsSumValue: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  itemsMismatchNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  itemsMismatchText: {
    fontSize: 11,
    color: COLORS.warning,
    flex: 1,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
    marginTop: 8,
  },
  deleteButtonText: {
    color: COLORS.danger,
    fontSize: 14,
    fontWeight: '500',
  },
});
