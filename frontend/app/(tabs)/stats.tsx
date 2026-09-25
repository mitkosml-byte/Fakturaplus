import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  ImageBackground,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/services/api';
import { Summary, ChartDataPoint, SupplierOverviewResponse, SupplierStats, ChartType, SupplierDetailedResponse } from '../../src/types';
import { BarChart, LineChart, PieChart } from 'react-native-gifted-charts';
import { useTranslation } from '../../src/i18n';
import { useAuth } from '../../src/contexts/AuthContext';
import { Alert } from '../../src/utils/alert';
import { downloadAndShareFile } from '../../src/utils/downloadFile';

const { width } = Dimensions.get('window');
const chartWidth = width - 80;
const pieChartRadius = (width - 80) / 3;
const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

// Mirrors the rolling-window lengths GET /statistics/chart-data uses on the
// backend (now - timedelta(days=N)) - needed here to average turnover over
// the whole window, not just the days that happen to have entries.
const PERIOD_DAY_COUNT: Record<'week' | 'month' | 'year', number> = {
  week: 7,
  month: 30,
  year: 365,
};

// Color palette for charts
const CHART_COLORS = [
  '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#3B82F6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'
];

export default function StatsScreen() {
  const { t } = useTranslation();
  const { hasPermission, isOwner } = useAuth();
  const params = useLocalSearchParams<{ period?: string }>();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');

  // Lets other screens (e.g. the Home dashboard's average-turnover card)
  // deep-link straight into a specific period here instead of always
  // landing on the default "week" view.
  useEffect(() => {
    if (params.period === 'week' || params.period === 'month' || params.period === 'year') {
      setPeriod(params.period);
    }
  }, [params.period]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'suppliers' | 'items'>('overview');
  
  // Advanced supplier stats
  const [supplierOverview, setSupplierOverview] = useState<SupplierOverviewResponse | null>(null);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [supplierChartType, setSupplierChartType] = useState<ChartType>('pie');
  const [supplierRankingType, setSupplierRankingType] = useState<'amount' | 'frequency' | 'avg'>('amount');
  
  // Supplier detail modal
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [supplierDetail, setSupplierDetail] = useState<SupplierDetailedResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Supplier comparison
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [compareModalVisible, setCompareModalVisible] = useState(false);
  const [compareResult, setCompareResult] = useState<any>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  // Item statistics
  const [itemStats, setItemStats] = useState<any>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [priceAlerts, setPriceAlerts] = useState<any[]>([]);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [itemRankingType, setItemRankingType] = useState<'quantity' | 'value' | 'frequency'>('value');
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [itemPriceHistory, setItemPriceHistory] = useState<any>(null);
  const [itemBySupplier, setItemBySupplier] = useState<any>(null);
  const [loadingItemDetail, setLoadingItemDetail] = useState(false);

  // Price inflation (overall spend-weighted price change across items over a period)
  const [inflationPeriod, setInflationPeriod] = useState<'month' | 'quarter' | 'year'>('quarter');
  const [inflationData, setInflationData] = useState<any>(null);
  const [loadingInflation, setLoadingInflation] = useState(false);
  const [inflationExpanded, setInflationExpanded] = useState(false);

  // Overview enrichments: previous-month comparison, top-3 quick view,
  // forecast and ROI trend
  const [previousSummary, setPreviousSummary] = useState<Summary | null>(null);
  const [topSuppliers, setTopSuppliers] = useState<SupplierStats[]>([]);
  const [topItems, setTopItems] = useState<any[]>([]);
  const [expenseForecast, setExpenseForecast] = useState<any>(null);
  const [revenueForecast, setRevenueForecast] = useState<any>(null);
  const [roiTrend, setRoiTrend] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    try {
      const now = new Date();
      const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthStart = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), 1).toISOString();
      const prevMonthEnd = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0, 23, 59, 59).toISOString();

      const [summaryData, chartDataResult, prevSummaryData] = await Promise.all([
        api.getSummary(),
        api.getChartData(period),
        api.getSummary({ start_date: prevMonthStart, end_date: prevMonthEnd }),
      ]);
      setSummary(summaryData);
      setChartData(chartDataResult);
      setPreviousSummary(prevSummaryData);
    } catch (error) {
      console.error('Error loading stats:', error);
    }

    if (hasPermission('view_statistics')) {
      try {
        const [supplierData, itemData] = await Promise.all([
          api.getSupplierOverview(),
          api.getItemStatistics({ top_n: 3 }),
        ]);
        setTopSuppliers((supplierData.top_by_amount || []).slice(0, 3));
        setTopItems(itemData.top_by_value || []);
      } catch (error) {
        console.error('Error loading top suppliers/items:', error);
      }

      try {
        const [expFc, revFc] = await Promise.all([
          api.getExpenseForecast(1),
          api.getRevenueForecast(1),
        ]);
        setExpenseForecast(expFc);
        setRevenueForecast(revFc);
      } catch (error) {
        console.error('Error loading forecast:', error);
      }
    }

    if (isOwner) {
      try {
        const roiTrendData = await api.getROITrend(6);
        setRoiTrend(roiTrendData.trend || []);
      } catch (error) {
        console.error('Error loading ROI trend:', error);
      }
    }
  }, [period, hasPermission, isOwner]);

  const loadSupplierStats = useCallback(async () => {
    setLoadingSuppliers(true);
    try {
      const data = await api.getSupplierOverview();
      setSupplierOverview(data);
    } catch (error) {
      console.error('Error loading supplier stats:', error);
    } finally {
      setLoadingSuppliers(false);
    }
  }, []);

  const loadSupplierDetail = useCallback(async (supplierName: string) => {
    setLoadingDetail(true);
    try {
      const data = await api.getSupplierDetailed(supplierName);
      setSupplierDetail(data);
    } catch (error) {
      console.error('Error loading supplier detail:', error);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const toggleCompareSelection = (supplierName: string) => {
    setSelectedForCompare((prev) => {
      if (prev.includes(supplierName)) {
        return prev.filter((s) => s !== supplierName);
      }
      if (prev.length >= 5) {
        Alert.alert(t('common.error'), t('stats.compareMaxReached'));
        return prev;
      }
      return [...prev, supplierName];
    });
  };

  const runCompareSuppliers = async () => {
    if (selectedForCompare.length < 2) {
      Alert.alert(t('common.error'), t('stats.compareMinRequired'));
      return;
    }
    setLoadingCompare(true);
    setCompareModalVisible(true);
    try {
      const data = await api.compareSuppliers(selectedForCompare);
      setCompareResult(data);
    } catch (error) {
      console.error('Error comparing suppliers:', error);
    } finally {
      setLoadingCompare(false);
    }
  };

  const exitCompareMode = () => {
    setCompareMode(false);
    setSelectedForCompare([]);
  };

  const handleExportStatisticsPdf = async () => {
    try {
      await downloadAndShareFile('/api/export/statistics/pdf', `statistics_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      Alert.alert(t('common.error'), t('invoices.downloadError'));
    }
  };

  // Item statistics functions
  const loadItemStats = useCallback(async () => {
    setLoadingItems(true);
    try {
      const [statsData, alertsData] = await Promise.all([
        api.getItemStatistics(),
        api.getPriceAlerts()
      ]);
      setItemStats(statsData);
      setPriceAlerts(alertsData.alerts || []);
      setUnreadAlerts(alertsData.unread_count || 0);
    } catch (error) {
      console.error('Error loading item stats:', error);
    } finally {
      setLoadingItems(false);
    }
  }, []);
  
  const loadItemDetail = useCallback(async (itemName: string) => {
    setLoadingItemDetail(true);
    try {
      const [historyData, supplierData] = await Promise.all([
        api.getItemPriceHistory(itemName),
        api.getItemBySupplier(itemName)
      ]);
      setItemPriceHistory(historyData);
      setItemBySupplier(supplierData);
    } catch (error) {
      console.error('Error loading item detail:', error);
    } finally {
      setLoadingItemDetail(false);
    }
  }, []);
  
  const getInflationDateRange = (preset: 'month' | 'quarter' | 'year') => {
    const end = new Date();
    const start = new Date();
    if (preset === 'month') start.setMonth(start.getMonth() - 1);
    else if (preset === 'quarter') start.setMonth(start.getMonth() - 3);
    else start.setFullYear(start.getFullYear() - 1);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { start_date: fmt(start), end_date: fmt(end) };
  };

  const loadInflation = useCallback(async (preset: 'month' | 'quarter' | 'year') => {
    setLoadingInflation(true);
    try {
      const { start_date, end_date } = getInflationDateRange(preset);
      const data = await api.getPriceInflation(start_date, end_date);
      setInflationData(data);
    } catch (error) {
      console.error('Error loading price inflation:', error);
    } finally {
      setLoadingInflation(false);
    }
  }, []);

  const markAlertAsRead = async (alertId: string) => {
    try {
      await api.updatePriceAlert(alertId, 'read');
      setPriceAlerts(prev => prev.map(a => a.id === alertId ? {...a, status: 'read'} : a));
      setUnreadAlerts(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error updating alert:', error);
    }
  };
  
  const dismissAlert = async (alertId: string) => {
    try {
      await api.updatePriceAlert(alertId, 'dismissed');
      setPriceAlerts(prev => prev.filter(a => a.id !== alertId));
      setUnreadAlerts(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error dismissing alert:', error);
    }
  };

  // Tab screens stay mounted, so returning here (e.g. after scanning and
  // saving a new invoice) doesn't remount the screen - only re-fetching on
  // focus picks up the change without needing a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  useEffect(() => {
    if (activeTab === 'suppliers' && !supplierOverview) {
      loadSupplierStats();
    }
  }, [activeTab, supplierOverview, loadSupplierStats]);
  
  useEffect(() => {
    if (activeTab === 'items' && !itemStats) {
      loadItemStats();
    }
  }, [activeTab, itemStats, loadItemStats]);

  useEffect(() => {
    if (activeTab === 'items') {
      loadInflation(inflationPeriod);
    }
  }, [activeTab, inflationPeriod, loadInflation]);

  useEffect(() => {
    if (selectedSupplier) {
      loadSupplierDetail(selectedSupplier);
    }
  }, [selectedSupplier, loadSupplierDetail]);
  
  useEffect(() => {
    if (selectedItem) {
      loadItemDetail(selectedItem);
    }
  }, [selectedItem, loadItemDetail]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (activeTab === 'overview') {
      await loadData();
    } else if (activeTab === 'suppliers') {
      await loadSupplierStats();
    } else {
      await loadItemStats();
    }
    setRefreshing(false);
  }, [loadData, loadSupplierStats, loadItemStats, activeTab]);
  
  // Get current item ranking
  const getCurrentItemRanking = () => {
    if (!itemStats) return [];
    switch (itemRankingType) {
      case 'quantity':
        return itemStats.top_by_quantity || [];
      case 'frequency':
        return itemStats.top_by_frequency || [];
      default:
        return itemStats.top_by_value || [];
    }
  };

  // Chart data for overview
  const incomeBarData = chartData.map((item) => ({
    value: item.income,
    label: item.label,
    frontColor: '#10B981',
    topLabelComponent: () => (
      <Text style={{ color: '#10B981', fontSize: 10 }}>
        {item.income > 0 ? item.income.toFixed(0) : ''}
      </Text>
    ),
  }));

  const expenseBarData = chartData.map((item) => ({
    value: item.expense,
    label: item.label,
    frontColor: '#EF4444',
    topLabelComponent: () => (
      <Text style={{ color: '#EF4444', fontSize: 10 }}>
        {item.expense > 0 ? item.expense.toFixed(0) : ''}
      </Text>
    ),
  }));

  // Small "+12% спрямо миналия месец" style badge for the summary cards
  const renderTrendBadge = (current?: number, previous?: number, higherIsBetter: boolean = true) => {
    if (current === undefined || previous === undefined || !previous) return null;
    const diff = current - previous;
    const percent = (diff / Math.abs(previous)) * 100;
    if (Math.abs(percent) < 1) return null;
    const isUp = diff > 0;
    const isGood = higherIsBetter ? isUp : !isUp;
    return (
      <View style={styles.trendBadge}>
        <Ionicons name={isUp ? 'arrow-up' : 'arrow-down'} size={11} color={isGood ? '#10B981' : '#EF4444'} />
        <Text style={[styles.trendBadgeText, { color: isGood ? '#10B981' : '#EF4444' }]}>
          {Math.abs(percent).toFixed(0)}%
        </Text>
      </View>
    );
  };

  // Get current ranking data
  const getCurrentRanking = (): SupplierStats[] => {
    if (!supplierOverview) return [];
    switch (supplierRankingType) {
      case 'frequency':
        return supplierOverview.top_by_frequency;
      case 'avg':
        return supplierOverview.top_by_avg;
      default:
        return supplierOverview.top_by_amount;
    }
  };

  // Prepare pie chart data
  const getPieChartData = () => {
    const ranking = getCurrentRanking();
    const top5 = ranking.slice(0, 5);
    const othersTotal = ranking.slice(5).reduce((sum, s) => sum + s.total_amount, 0);
    
    const data = top5.map((supplier, index) => ({
      value: supplier.total_amount,
      color: CHART_COLORS[index],
      text: `${supplier.dependency_percent.toFixed(0)}%`,
      shiftTextX: -8,
      shiftTextY: 0,
    }));
    
    if (othersTotal > 0) {
      data.push({
        value: othersTotal,
        color: '#64748B',
        text: '',
        shiftTextX: 0,
        shiftTextY: 0,
      });
    }
    
    return data;
  };

  // Prepare bar chart data for suppliers
  const getSupplierBarData = () => {
    const ranking = getCurrentRanking().slice(0, 7);
    return ranking.map((supplier, index) => ({
      value: supplierRankingType === 'frequency' ? supplier.invoice_count :
             supplierRankingType === 'avg' ? supplier.avg_invoice : supplier.total_amount,
      // Company names are often quoted (e.g. "Марс-1" ООД) - strip a
      // leading quote before truncating so the label doesn't start with
      // a stray punctuation mark instead of an actual letter.
      label: supplier.supplier.replace(/^["'„”]+/, '').substring(0, 6),
      frontColor: CHART_COLORS[index % CHART_COLORS.length],
    }));
  };

  // Prepare line chart data for supplier monthly trend
  const getSupplierLineData = () => {
    if (!supplierDetail?.monthly_trend) return [];
    return supplierDetail.monthly_trend.map(m => ({
      value: m.amount,
      label: m.month.substring(5),
      dataPointColor: '#8B5CF6',
    }));
  };

  // Render chart type selector
  const renderChartTypeSelector = () => (
    <View style={styles.chartTypeSelector}>
      <TouchableOpacity
        style={[styles.chartTypeButton, supplierChartType === 'pie' && styles.chartTypeButtonActive]}
        onPress={() => setSupplierChartType('pie')}
      >
        <Ionicons name="pie-chart" size={18} color={supplierChartType === 'pie' ? 'white' : '#64748B'} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.chartTypeButton, supplierChartType === 'bar' && styles.chartTypeButtonActive]}
        onPress={() => setSupplierChartType('bar')}
      >
        <Ionicons name="bar-chart" size={18} color={supplierChartType === 'bar' ? 'white' : '#64748B'} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.chartTypeButton, supplierChartType === 'line' && styles.chartTypeButtonActive]}
        onPress={() => setSupplierChartType('line')}
      >
        <Ionicons name="trending-up" size={18} color={supplierChartType === 'line' ? 'white' : '#64748B'} />
      </TouchableOpacity>
    </View>
  );

  // Render supplier detail modal
  const renderSupplierDetailModal = () => (
    <Modal
      visible={!!selectedSupplier}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        setSelectedSupplier(null);
        setSupplierDetail(null);
      }}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity 
            style={styles.modalCloseButton}
            onPress={() => {
              setSelectedSupplier(null);
              setSupplierDetail(null);
            }}
          >
            <Ionicons name="close" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.modalTitle} numberOfLines={1}>{selectedSupplier}</Text>
          <View style={{ width: 40 }} />
        </View>

        {loadingDetail ? (
          <View style={styles.modalLoading}>
            <ActivityIndicator size="large" color="#8B5CF6" />
          </View>
        ) : supplierDetail?.found ? (
          <ScrollView style={styles.modalContent}>
            {/* Overview Card */}
            <View style={styles.detailCard}>
              <Text style={styles.detailCardTitle}>{t('stats.supplierOverview')}</Text>
              <View style={styles.detailGrid}>
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{supplierDetail.overview?.total_amount.toFixed(2)} €</Text>
                  <Text style={styles.detailLabel}>{t('stats.totalAmount')}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{supplierDetail.overview?.invoice_count}</Text>
                  <Text style={styles.detailLabel}>{t('stats.invoiceCount')}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{supplierDetail.overview?.avg_invoice.toFixed(2)} €</Text>
                  <Text style={styles.detailLabel}>{t('stats.avgInvoice')}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{supplierDetail.overview?.total_vat.toFixed(2)} €</Text>
                  <Text style={styles.detailLabel}>{t('stats.vat')}</Text>
                </View>
              </View>
              
              <View style={styles.detailDates}>
                <View style={styles.detailDateItem}>
                  <Ionicons name="calendar-outline" size={16} color="#64748B" />
                  <Text style={styles.detailDateLabel}>{t('stats.firstDelivery')}: </Text>
                  <Text style={styles.detailDateValue}>{supplierDetail.overview?.first_delivery || t('stats.noValue')}</Text>
                </View>
                <View style={styles.detailDateItem}>
                  <Ionicons name="time-outline" size={16} color="#64748B" />
                  <Text style={styles.detailDateLabel}>{t('stats.lastDelivery')}: </Text>
                  <Text style={styles.detailDateValue}>{supplierDetail.overview?.last_delivery || t('stats.noValue')}</Text>
                </View>
              </View>
              
              <View style={[
                styles.statusBadge, 
                { backgroundColor: supplierDetail.overview?.is_active ? '#10B98120' : '#EF444420' }
              ]}>
                <Ionicons 
                  name={supplierDetail.overview?.is_active ? "checkmark-circle" : "alert-circle"} 
                  size={16} 
                  color={supplierDetail.overview?.is_active ? '#10B981' : '#EF4444'} 
                />
                <Text style={[
                  styles.statusText, 
                  { color: supplierDetail.overview?.is_active ? '#10B981' : '#EF4444' }
                ]}>
                  {supplierDetail.overview?.is_active ? t('stats.activeSupplier') : `${t('stats.inactiveSupplier')} (${supplierDetail.overview?.days_inactive} ${t('stats.days')})`}
                </Text>
              </View>
            </View>

            {/* Monthly Trend Chart */}
            {supplierDetail.monthly_trend && supplierDetail.monthly_trend.length > 0 && (
              <View style={styles.detailCard}>
                <Text style={styles.detailCardTitle}>{t('stats.monthlyTrend')}</Text>
                <LineChart
                  data={getSupplierLineData()}
                  width={chartWidth - 20}
                  height={150}
                  color="#8B5CF6"
                  thickness={2}
                  dataPointsColor="#8B5CF6"
                  yAxisColor="#334155"
                  xAxisColor="#334155"
                  yAxisTextStyle={{ color: '#64748B', fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: '#64748B', fontSize: 9 }}
                  hideRules
                  isAnimated
                  curved
                />
              </View>
            )}

            {/* Anomalies */}
            {supplierDetail.anomalies && supplierDetail.anomalies.length > 0 && (
              <View style={styles.detailCard}>
                <View style={styles.anomalyHeader}>
                  <Ionicons name="warning" size={20} color="#F59E0B" />
                  <Text style={styles.detailCardTitle}>{t('stats.anomalies')}</Text>
                </View>
                {supplierDetail.anomalies.map((anomaly, index) => (
                  <View key={index} style={styles.anomalyItem}>
                    <View>
                      <Text style={styles.anomalyInvoice}>№{anomaly.invoice_number}</Text>
                      <Text style={styles.anomalyDate}>{anomaly.date}</Text>
                    </View>
                    <View style={styles.anomalyAmount}>
                      <Text style={styles.anomalyValue}>{anomaly.amount.toFixed(2)} €</Text>
                      <Text style={styles.anomalyDeviation}>+{anomaly.deviation_percent}%</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Recent Invoices */}
            {supplierDetail.recent_invoices && supplierDetail.recent_invoices.length > 0 && (
              <View style={styles.detailCard}>
                <Text style={styles.detailCardTitle}>{t('stats.recentInvoices')}</Text>
                {supplierDetail.recent_invoices.map((invoice, index) => (
                  <View key={index} style={styles.recentInvoiceItem}>
                    <View>
                      <Text style={styles.recentInvoiceNumber}>№{invoice.invoice_number}</Text>
                      <Text style={styles.recentInvoiceDate}>{invoice.date}</Text>
                    </View>
                    <Text style={styles.recentInvoiceAmount}>{invoice.total_amount.toFixed(2)} €</Text>
                  </View>
                ))}
              </View>
            )}
            
            <View style={{ height: 40 }} />
          </ScrollView>
        ) : (
          <View style={styles.modalLoading}>
            <Ionicons name="alert-circle-outline" size={48} color="#64748B" />
            <Text style={styles.noDataText}>{t('stats.noSupplierData')}</Text>
          </View>
        )}
      </View>
    </Modal>
  );

  // Render supplier comparison modal
  const renderCompareModal = () => {
    const maxAmount = compareResult?.suppliers?.length
      ? Math.max(...compareResult.suppliers.map((s: any) => s.total_amount), 1)
      : 1;
    return (
      <Modal
        visible={compareModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setCompareModalVisible(false);
          setCompareResult(null);
        }}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>{t('stats.compareTitle')}</Text>
            <TouchableOpacity onPress={() => { setCompareModalVisible(false); setCompareResult(null); }}>
              <Ionicons name="close" size={28} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {loadingCompare ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator size="large" color="#8B5CF6" />
            </View>
          ) : compareResult?.suppliers?.length ? (
            <ScrollView style={{ flex: 1, padding: 16 }}>
              {compareResult.suppliers.map((s: any, idx: number) => (
                <View key={s.supplier} style={styles.compareCard}>
                  <Text style={styles.compareSupplierName} numberOfLines={1}>{s.supplier}</Text>

                  <View style={styles.compareBarRow}>
                    <Text style={styles.compareBarLabel}>{t('stats.compareTotalAmount')}</Text>
                    <Text style={styles.compareBarValue}>{s.total_amount.toFixed(2)} €</Text>
                  </View>
                  <View style={styles.compareBarTrack}>
                    <View style={[styles.compareBarFill, { width: `${(s.total_amount / maxAmount) * 100}%`, backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }]} />
                  </View>

                  <View style={styles.compareStatsRow}>
                    <View style={styles.compareStatItem}>
                      <Text style={styles.compareStatLabel}>{t('stats.compareInvoiceCount')}</Text>
                      <Text style={styles.compareStatValue}>{s.invoice_count}</Text>
                    </View>
                    <View style={styles.compareStatItem}>
                      <Text style={styles.compareStatLabel}>{t('stats.compareAvgInvoice')}</Text>
                      <Text style={styles.compareStatValue}>{s.avg_invoice.toFixed(2)} €</Text>
                    </View>
                  </View>
                </View>
              ))}
              <View style={{ height: 40 }} />
            </ScrollView>
          ) : (
            <View style={styles.modalLoading}>
              <Ionicons name="alert-circle-outline" size={48} color="#64748B" />
              <Text style={styles.noDataText}>{t('stats.noData')}</Text>
            </View>
          )}
        </View>
      </Modal>
    );
  };

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <ScrollView
            style={styles.scrollView}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
          >
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{t('stats.title')}</Text>
                <Text style={styles.subtitle}>{t('stats.subtitle')}</Text>
              </View>
              {hasPermission('export_data') && (
                <TouchableOpacity style={styles.exportButton} onPress={handleExportStatisticsPdf}>
                  <Ionicons name="download" size={22} color="#8B5CF6" />
                </TouchableOpacity>
              )}
            </View>

            {/* Tab Selector */}
            <View style={styles.tabSelector}>
              <TouchableOpacity
                style={[styles.tabButton, activeTab === 'overview' && styles.tabButtonActive]}
                onPress={() => setActiveTab('overview')}
              >
                <Ionicons name="bar-chart" size={16} color={activeTab === 'overview' ? 'white' : '#64748B'} />
                <Text style={[styles.tabButtonText, activeTab === 'overview' && styles.tabButtonTextActive]}>
                  {t('stats.overview')}
                </Text>
              </TouchableOpacity>
              {/* Suppliers tab - Only for Owner/Manager */}
              {hasPermission('view_statistics') && (
                <TouchableOpacity
                  style={[styles.tabButton, activeTab === 'suppliers' && styles.tabButtonActive]}
                  onPress={() => setActiveTab('suppliers')}
                >
                  <Ionicons name="business" size={16} color={activeTab === 'suppliers' ? 'white' : '#64748B'} />
                  <Text style={[styles.tabButtonText, activeTab === 'suppliers' && styles.tabButtonTextActive]}>
                    {t('stats.suppliers')}
                  </Text>
                </TouchableOpacity>
              )}
              {/* Items tab - Only for Owner/Manager */}
              {hasPermission('view_statistics') && (
                <TouchableOpacity
                  style={[styles.tabButton, activeTab === 'items' && styles.tabButtonActive]}
                  onPress={() => setActiveTab('items')}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="pricetags" size={16} color={activeTab === 'items' ? 'white' : '#64748B'} />
                    {unreadAlerts > 0 && (
                      <View style={styles.alertBadge}>
                        <Text style={styles.alertBadgeText}>{unreadAlerts}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.tabButtonText, activeTab === 'items' && styles.tabButtonTextActive]}>
                    {t('stats.items')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {activeTab === 'overview' ? (
              <>
                {/* Period Selector */}
                <View style={styles.periodSelector}>
                  {(['week', 'month', 'year'] as const).map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.periodButton, period === p && styles.periodButtonActive]}
                      onPress={() => setPeriod(p)}
                    >
                      <Text style={[styles.periodButtonText, period === p && styles.periodButtonTextActive]}>
                        {p === 'week' ? t('stats.week') : p === 'month' ? t('stats.month') : t('stats.year')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Average Daily Turnover - reacts to the same period selector above,
                    so it doubles as period-by-period business analysis rather than
                    a single fixed number. Divided by calendar days in the rolling
                    window (not just days with entries), matching the backend's
                    week/month/year window definition in getChartData. */}
                <View style={styles.avgTurnoverStatCard}>
                  <View style={styles.avgTurnoverStatHeader}>
                    <Ionicons name="speedometer" size={24} color="#3B82F6" />
                    <Text style={styles.avgTurnoverStatTitle}>{t('stats.avgDailyTurnover')}</Text>
                  </View>
                  <Text style={styles.avgTurnoverStatValue}>
                    {(chartData.reduce((sum, d) => sum + d.income, 0) / PERIOD_DAY_COUNT[period]).toFixed(2)} €
                  </Text>
                  <Text style={styles.avgTurnoverStatSubtitle}>
                    {t('stats.avgDailyTurnoverSubtitle').replace('{days}', String(PERIOD_DAY_COUNT[period]))}
                  </Text>
                </View>

                {/* Summary Cards */}
                <View style={styles.summaryGrid}>
                  <View style={[styles.summaryCard, { borderLeftColor: '#10B981' }]}>
                    <Ionicons name="trending-up" size={24} color="#10B981" />
                    <Text style={styles.cardLabel}>{t('stats.totalIncome')}</Text>
                    <Text style={[styles.cardValue, { color: '#10B981' }]}>
                      {summary?.total_income.toFixed(2) || '0.00'} €
                    </Text>
                    {renderTrendBadge(summary?.total_income, previousSummary?.total_income, true)}
                  </View>
                  <View style={[styles.summaryCard, { borderLeftColor: '#EF4444' }]}>
                    <Ionicons name="trending-down" size={24} color="#EF4444" />
                    <Text style={styles.cardLabel}>{t('stats.totalExpense')}</Text>
                    <Text style={[styles.cardValue, { color: '#EF4444' }]}>
                      {summary?.total_expense.toFixed(2) || '0.00'} €
                    </Text>
                    {renderTrendBadge(summary?.total_expense, previousSummary?.total_expense, false)}
                  </View>
                  <View style={[styles.summaryCard, { borderLeftColor: '#8B5CF6' }]}>
                    <Ionicons name="calculator" size={24} color="#8B5CF6" />
                    <Text style={styles.cardLabel}>{t('stats.vatToPay')}</Text>
                    <Text style={[styles.cardValue, { color: (summary?.vat_to_pay || 0) >= 0 ? '#EF4444' : '#10B981' }]}>
                      {summary?.vat_to_pay.toFixed(2) || '0.00'} €
                    </Text>
                    {renderTrendBadge(summary?.vat_to_pay, previousSummary?.vat_to_pay, false)}
                  </View>
                  <View style={[styles.summaryCard, { borderLeftColor: '#F59E0B' }]}>
                    <Ionicons name="wallet" size={24} color="#F59E0B" />
                    <Text style={styles.cardLabel}>{t('stats.profitLabel')}</Text>
                    <Text style={[styles.cardValue, { color: (summary?.profit || 0) >= 0 ? '#10B981' : '#EF4444' }]}>
                      {summary?.profit.toFixed(2) || '0.00'} €
                    </Text>
                    {renderTrendBadge(summary?.profit, previousSummary?.profit, true)}
                  </View>
                </View>

                {/* Income Chart */}
                <View style={styles.chartContainer}>
                  <View style={styles.chartHeader}>
                    <Ionicons name="arrow-up-circle" size={24} color="#10B981" />
                    <Text style={styles.chartTitle}>{t('stats.income')}</Text>
                  </View>
                  {incomeBarData.length > 0 ? (() => {
                    // Size bars/spacing to the actual day count so all of them
                    // fit within the chart's width - a fixed barWidth/spacing
                    // overflowed past the visible area with a full week/month
                    // of days, clipping the last bar's label instead of
                    // shrinking to fit (same fix as the supplier chart below).
                    const yAxisLabelWidth = 34;
                    const spacing = 8;
                    const plotWidth = chartWidth - yAxisLabelWidth;
                    const barWidth = Math.max(10, Math.min(20, Math.floor((plotWidth - spacing * (incomeBarData.length + 1)) / incomeBarData.length)));
                    return (
                      <BarChart
                        data={incomeBarData}
                        width={plotWidth}
                        height={180}
                        barWidth={barWidth}
                        spacing={spacing}
                        initialSpacing={spacing}
                        endSpacing={spacing}
                        noOfSections={4}
                        barBorderRadius={4}
                        frontColor="#10B981"
                        yAxisColor="#334155"
                        xAxisColor="#334155"
                        yAxisTextStyle={{ color: '#64748B', fontSize: 10 }}
                        xAxisLabelTextStyle={{ color: '#64748B', fontSize: 9 }}
                        yAxisLabelWidth={yAxisLabelWidth}
                        hideRules
                        isAnimated
                      />
                    );
                  })() : (
                    <View style={styles.noDataContainer}>
                      <Text style={styles.noDataText}>{t('stats.noData')}</Text>
                    </View>
                  )}
                </View>

                {/* Expense Chart */}
                <View style={styles.chartContainer}>
                  <View style={styles.chartHeader}>
                    <Ionicons name="arrow-down-circle" size={24} color="#EF4444" />
                    <Text style={styles.chartTitle}>{t('home.totalExpenses')}</Text>
                  </View>
                  {expenseBarData.length > 0 ? (() => {
                    const yAxisLabelWidth = 34;
                    const spacing = 8;
                    const plotWidth = chartWidth - yAxisLabelWidth;
                    const barWidth = Math.max(10, Math.min(20, Math.floor((plotWidth - spacing * (expenseBarData.length + 1)) / expenseBarData.length)));
                    return (
                      <BarChart
                        data={expenseBarData}
                        width={plotWidth}
                        height={180}
                        barWidth={barWidth}
                        spacing={spacing}
                        initialSpacing={spacing}
                        endSpacing={spacing}
                        noOfSections={4}
                        barBorderRadius={4}
                        frontColor="#EF4444"
                        yAxisColor="#334155"
                        xAxisColor="#334155"
                        yAxisTextStyle={{ color: '#64748B', fontSize: 10 }}
                        xAxisLabelTextStyle={{ color: '#64748B', fontSize: 9 }}
                        yAxisLabelWidth={yAxisLabelWidth}
                        hideRules
                        isAnimated
                      />
                    );
                  })() : (
                    <View style={styles.noDataContainer}>
                      <Text style={styles.noDataText}>{t('stats.noData')}</Text>
                    </View>
                  )}
                </View>

                {/* VAT Breakdown */}
                <View style={styles.vatBreakdown}>
                  <Text style={styles.sectionTitle}>{t('stats.vatBreakdown')}</Text>
                  
                  <View style={styles.vatRow}>
                    <View style={styles.vatItem}>
                      <Text style={styles.vatLabel}>{t('stats.vatFromSales')}</Text>
                      <Text style={[styles.vatValue, { color: '#EF4444' }]}>
                        +{summary?.fiscal_vat.toFixed(2) || '0.00'} €
                      </Text>
                    </View>
                    <View style={styles.vatItem}>
                      <Text style={styles.vatLabel}>{t('stats.vatCredit')}</Text>
                      <Text style={[styles.vatValue, { color: '#10B981' }]}>
                        -{summary?.total_invoice_vat.toFixed(2) || '0.00'} €
                      </Text>
                    </View>
                  </View>

                  <View style={styles.vatTotal}>
                    <Text style={styles.vatTotalLabel}>{t('stats.vatToPay')}</Text>
                    <Text style={[styles.vatTotalValue, { color: (summary?.vat_to_pay || 0) >= 0 ? '#EF4444' : '#10B981' }]}>
                      {summary?.vat_to_pay.toFixed(2) || '0.00'} €
                    </Text>
                  </View>
                </View>

                {/* Additional Stats */}
                <View style={styles.additionalStats}>
                  <Text style={styles.sectionTitle}>{t('stats.additionalInfo')}</Text>
                  
                  <View style={styles.statRow}>
                    <View style={styles.statItem}>
                      <Ionicons name="receipt" size={20} color="#8B5CF6" />
                      <Text style={styles.statLabel}>{t('stats.invoiceCount')}</Text>
                      <Text style={styles.statValue}>{summary?.invoice_count || 0}</Text>
                    </View>
                    <View style={styles.statItem}>
                      <Ionicons name="cash" size={20} color="#10B981" />
                      <Text style={styles.statLabel}>{t('home.fiscalRevenue')}</Text>
                      <Text style={styles.statValue}>{summary?.total_fiscal_revenue.toFixed(0) || 0} €</Text>
                    </View>
                  </View>

                  <View style={styles.statRow}>
                    <View style={styles.statItem}>
                      <Ionicons name="wallet" size={20} color="#F59E0B" />
                      <Text style={styles.statLabel}>{t('home.pocket')}</Text>
                      <Text style={styles.statValue}>{summary?.total_pocket_money.toFixed(0) || 0} €</Text>
                    </View>
                    <View style={styles.statItem}>
                      <Ionicons name="remove-circle" size={20} color="#EF4444" />
                      <Text style={styles.statLabel}>{t('stats.expensesNoInvoice')}</Text>
                      <Text style={styles.statValue}>{summary?.total_non_invoice_expenses.toFixed(0) || 0} €</Text>
                    </View>
                  </View>

                  {!!summary?.total_payroll_cost && (
                    <View style={styles.statRow}>
                      <View style={[styles.statItem, { flex: 1 }]}>
                        <Ionicons name="people" size={20} color="#10B981" />
                        <Text style={styles.statLabel}>{t('payroll.totalCostThisMonth')}</Text>
                        <Text style={styles.statValue}>{summary.total_payroll_cost.toFixed(2)} €</Text>
                      </View>
                    </View>
                  )}

                  {!!summary?.total_depreciation_expense && (
                    <View style={styles.statRow}>
                      <View style={[styles.statItem, { flex: 1 }]}>
                        <Ionicons name="business" size={20} color="#F59E0B" />
                        <Text style={styles.statLabel}>{t('assets.depreciationThisMonth')}</Text>
                        <Text style={styles.statValue}>{summary.total_depreciation_expense.toFixed(2)} €</Text>
                      </View>
                    </View>
                  )}
                </View>

                {/* Top 3 quick view */}
                {hasPermission('view_statistics') && (topSuppliers.length > 0 || topItems.length > 0) && (
                  <View style={styles.top3Section}>
                    <Text style={styles.sectionTitle}>{t('stats.top3Title')}</Text>
                    <View style={styles.top3Row}>
                      <View style={styles.top3Column}>
                        <Text style={styles.top3ColumnTitle}>{t('stats.topSuppliers')}</Text>
                        {topSuppliers.length > 0 ? (
                          topSuppliers.map((s, idx) => (
                            <View key={s.supplier} style={styles.top3Item}>
                              <Text style={styles.top3Rank}>{idx + 1}</Text>
                              <Text style={styles.top3Name} numberOfLines={1}>{s.supplier}</Text>
                              <Text style={styles.top3Value}>{s.total_amount.toFixed(0)} €</Text>
                            </View>
                          ))
                        ) : (
                          <Text style={styles.noDataText}>{t('stats.noData')}</Text>
                        )}
                      </View>
                      <View style={styles.top3Column}>
                        <Text style={styles.top3ColumnTitle}>{t('stats.topItems')}</Text>
                        {topItems.length > 0 ? (
                          topItems.map((item, idx) => (
                            <View key={item.item_name} style={styles.top3Item}>
                              <Text style={styles.top3Rank}>{idx + 1}</Text>
                              <Text style={styles.top3Name} numberOfLines={1}>{item.item_name}</Text>
                              <Text style={styles.top3Value}>{item.total_value.toFixed(0)} €</Text>
                            </View>
                          ))
                        ) : (
                          <Text style={styles.noDataText}>{t('stats.noData')}</Text>
                        )}
                      </View>
                    </View>
                  </View>
                )}

                {/* Forecast */}
                {hasPermission('view_statistics') && (revenueForecast?.forecast?.length > 0 || expenseForecast?.forecast?.length > 0) && (
                  <View style={styles.forecastSection}>
                    <View style={styles.chartHeader}>
                      <Ionicons name="analytics" size={22} color="#8B5CF6" />
                      <Text style={styles.chartTitle}>{t('stats.forecastTitle')}</Text>
                    </View>
                    <Text style={styles.forecastHint}>{t('stats.forecastHint')}</Text>
                    <View style={styles.forecastRow}>
                      {revenueForecast?.forecast?.[0] && (
                        <View style={styles.forecastCard}>
                          <Ionicons name="trending-up" size={20} color="#10B981" />
                          <Text style={styles.forecastLabel}>{t('stats.forecastRevenue')}</Text>
                          <Text style={[styles.forecastValue, { color: '#10B981' }]}>
                            {revenueForecast.forecast[0].predicted_amount.toFixed(0)} €
                          </Text>
                          <Text style={styles.forecastTrend}>
                            {revenueForecast.trend === 'increasing' ? '📈' : revenueForecast.trend === 'decreasing' ? '📉' : '➖'}
                            {' '}{revenueForecast.trend_percent > 0 ? '+' : ''}{revenueForecast.trend_percent}%
                          </Text>
                        </View>
                      )}
                      {expenseForecast?.forecast?.[0] && (
                        <View style={styles.forecastCard}>
                          <Ionicons name="trending-down" size={20} color="#EF4444" />
                          <Text style={styles.forecastLabel}>{t('stats.forecastExpense')}</Text>
                          <Text style={[styles.forecastValue, { color: '#EF4444' }]}>
                            {expenseForecast.forecast[0].predicted_amount.toFixed(0)} €
                          </Text>
                          <Text style={styles.forecastTrend}>
                            {expenseForecast.trend === 'increasing' ? '📈' : expenseForecast.trend === 'decreasing' ? '📉' : '➖'}
                            {' '}{expenseForecast.trend_percent > 0 ? '+' : ''}{expenseForecast.trend_percent}%
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}

                {/* ROI Trend (Owner only) */}
                {isOwner && roiTrend.length > 0 && (
                  <View style={styles.chartContainer}>
                    <View style={styles.chartHeader}>
                      <Ionicons name="pulse" size={24} color="#8B5CF6" />
                      <Text style={styles.chartTitle}>{t('stats.roiTrendTitle')}</Text>
                    </View>
                    <LineChart
                      data={roiTrend.map((pt) => ({ value: pt.roi_percent, label: pt.label }))}
                      width={chartWidth}
                      height={180}
                      color="#8B5CF6"
                      thickness={3}
                      dataPointsColor="#8B5CF6"
                      yAxisColor="#334155"
                      xAxisColor="#334155"
                      yAxisTextStyle={{ color: '#64748B', fontSize: 10 }}
                      xAxisLabelTextStyle={{ color: '#64748B', fontSize: 9 }}
                      noOfSections={4}
                      hideRules
                      isAnimated
                      curved
                    />
                  </View>
                )}

                <View style={{ height: 40 }} />
              </>
            ) : activeTab === 'suppliers' ? (
              /* ========== ADVANCED SUPPLIERS TAB ========== */
              <View style={styles.suppliersContainer}>
                {loadingSuppliers ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#8B5CF6" />
                    <Text style={styles.loadingText}>{t('stats.loadingData')}</Text>
                  </View>
                ) : supplierOverview ? (
                  <>
                    {/* Executive Summary */}
                    <View style={styles.executiveSummaryCard}>
                      <View style={styles.execSummaryHeader}>
                        <Ionicons name="analytics" size={24} color="#8B5CF6" />
                        <Text style={styles.execSummaryTitle}>{t('stats.executiveSummary')}</Text>
                      </View>
                      
                      <View style={styles.execSummaryGrid}>
                        <View style={styles.execItem}>
                          <Text style={styles.execValue}>{supplierOverview.executive_summary.total_suppliers}</Text>
                          <Text style={styles.execLabel}>{t('stats.totalSuppliers')}</Text>
                        </View>
                        <View style={styles.execItem}>
                          <Text style={[styles.execValue, { color: '#10B981' }]}>
                            {supplierOverview.executive_summary.active_suppliers}
                          </Text>
                          <Text style={styles.execLabel}>{t('stats.activeSuppliers')}</Text>
                        </View>
                        <View style={styles.execItem}>
                          <Text style={[styles.execValue, { color: '#EF4444' }]}>
                            {supplierOverview.executive_summary.inactive_suppliers}
                          </Text>
                          <Text style={styles.execLabel}>{t('stats.inactiveSuppliers')}</Text>
                        </View>
                      </View>
                      
                      {/* Concentration indicators */}
                      <View style={styles.concentrationRow}>
                        <View style={styles.concentrationItem}>
                          <Text style={styles.concentrationLabel}>{t('stats.top3Concentration')}</Text>
                          <View style={styles.concentrationBar}>
                            <View style={[styles.concentrationFill, { 
                              width: `${Math.min(supplierOverview.executive_summary.top_3_concentration, 100)}%`,
                              backgroundColor: supplierOverview.executive_summary.top_3_concentration > 70 ? '#EF4444' : '#10B981'
                            }]} />
                          </View>
                          <Text style={styles.concentrationValue}>
                            {supplierOverview.executive_summary.top_3_concentration.toFixed(1)}%
                          </Text>
                        </View>
                      </View>
                      
                      {/* High dependency alert */}
                      {supplierOverview.executive_summary.high_dependency_count > 0 && (
                        <View style={styles.alertBanner}>
                          <Ionicons name="warning" size={18} color="#F59E0B" />
                          <Text style={styles.alertText}>
                            {supplierOverview.executive_summary.high_dependency_count} {t('stats.highDependencyAlert')}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Totals Summary */}
                    <View style={styles.supplierTotalsCard}>
                      <Text style={styles.supplierTotalsTitle}>{t('stats.currentMonthTotal')}</Text>
                      <View style={styles.supplierTotalsRow}>
                        <View style={styles.supplierTotalItem}>
                          <Text style={styles.supplierTotalValue}>
                            {supplierOverview.totals.total_amount.toFixed(2)} €
                          </Text>
                          <Text style={styles.supplierTotalLabel}>{t('stats.totalAmount')}</Text>
                        </View>
                        <View style={styles.supplierTotalItem}>
                          <Text style={styles.supplierTotalValue}>
                            {supplierOverview.totals.total_vat.toFixed(2)} €
                          </Text>
                          <Text style={styles.supplierTotalLabel}>{t('stats.vat')}</Text>
                        </View>
                      </View>
                      <View style={styles.supplierTotalsRow}>
                        <View style={styles.supplierTotalItem}>
                          <Text style={styles.supplierTotalValue}>
                            {supplierOverview.totals.supplier_count}
                          </Text>
                          <Text style={styles.supplierTotalLabel}>{t('stats.supplierCount')}</Text>
                        </View>
                        <View style={styles.supplierTotalItem}>
                          <Text style={styles.supplierTotalValue}>
                            {supplierOverview.totals.invoice_count}
                          </Text>
                          <Text style={styles.supplierTotalLabel}>{t('stats.invoiceCount')}</Text>
                        </View>
                      </View>
                    </View>

                    {/* Chart Type & Ranking Selectors */}
                    <View style={styles.chartControlsContainer}>
                      {renderChartTypeSelector()}
                      
                      <View style={styles.rankingSelector}>
                        <TouchableOpacity
                          style={[styles.rankingButton, supplierRankingType === 'amount' && styles.rankingButtonActive]}
                          onPress={() => setSupplierRankingType('amount')}
                        >
                          <Text style={[styles.rankingButtonText, supplierRankingType === 'amount' && styles.rankingButtonTextActive]}>
                            {t('stats.byAmount')}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.rankingButton, supplierRankingType === 'frequency' && styles.rankingButtonActive]}
                          onPress={() => setSupplierRankingType('frequency')}
                        >
                          <Text style={[styles.rankingButtonText, supplierRankingType === 'frequency' && styles.rankingButtonTextActive]}>
                            {t('stats.byFrequency')}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.rankingButton, supplierRankingType === 'avg' && styles.rankingButtonActive]}
                          onPress={() => setSupplierRankingType('avg')}
                        >
                          <Text style={[styles.rankingButtonText, supplierRankingType === 'avg' && styles.rankingButtonTextActive]}>
                            {t('stats.byAvg')}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Chart Display */}
                    <View style={styles.chartContainer}>
                      <View style={styles.chartHeader}>
                        <Ionicons name="trophy" size={24} color="#F59E0B" />
                        <Text style={styles.chartTitle}>{t('stats.top10')}</Text>
                      </View>
                      
                      {supplierChartType === 'pie' && getPieChartData().length > 0 && (
                        <View style={styles.pieChartContainer}>
                          <PieChart
                            data={getPieChartData()}
                            radius={pieChartRadius}
                            innerRadius={pieChartRadius * 0.5}
                            centerLabelComponent={() => (
                              <View style={styles.pieCenter}>
                                <Text style={styles.pieCenterValue}>
                                  {supplierOverview.totals.total_amount.toFixed(0)}€
                                </Text>
                                <Text style={styles.pieCenterLabel}>{t('stats.totalAmount')}</Text>
                              </View>
                            )}
                            showText
                            textColor="white"
                            textSize={10}
                          />
                          
                          {/* Legend */}
                          <View style={styles.legendContainer}>
                            {getCurrentRanking().slice(0, 5).map((supplier, index) => (
                              <TouchableOpacity 
                                key={supplier.supplier} 
                                style={styles.legendItem}
                                onPress={() => setSelectedSupplier(supplier.supplier)}
                              >
                                <View style={[styles.legendColor, { backgroundColor: CHART_COLORS[index] }]} />
                                <Text style={styles.legendText} numberOfLines={1}>{supplier.supplier}</Text>
                                <Text style={styles.legendValue}>{supplier.dependency_percent.toFixed(0)}%</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      )}
                      
                      {(() => {
                        const barData = getSupplierBarData();
                        if (barData.length === 0) return null;
                        // Size bars/spacing to the actual item count so all
                        // of them fit within the chart's width - a fixed
                        // barWidth/spacing overflowed past the visible area
                        // with 6-7 suppliers, clipping the last bar instead
                        // of shrinking to fit.
                        const yAxisLabelWidth = 34;
                        const spacing = 8;
                        const plotWidth = chartWidth - yAxisLabelWidth;
                        const barWidth = Math.max(16, Math.min(30, Math.floor((plotWidth - spacing * (barData.length + 1)) / barData.length)));
                        return (
                          <BarChart
                            data={barData}
                            width={plotWidth}
                            height={200}
                            barWidth={barWidth}
                            spacing={spacing}
                            initialSpacing={spacing}
                        endSpacing={spacing}
                            noOfSections={4}
                            barBorderRadius={4}
                            yAxisColor="#334155"
                            xAxisColor="#334155"
                            yAxisTextStyle={{ color: '#64748B', fontSize: 10 }}
                            xAxisLabelTextStyle={{ color: '#64748B', fontSize: 9 }}
                            yAxisLabelWidth={yAxisLabelWidth}
                            hideRules
                            isAnimated
                          />
                        );
                      })()}
                      
                      {supplierChartType === 'line' && getSupplierBarData().length > 0 && (
                        <LineChart
                          data={getSupplierBarData().map(d => ({ value: d.value, label: d.label, dataPointColor: '#8B5CF6' }))}
                          width={chartWidth}
                          height={200}
                          color="#8B5CF6"
                          thickness={3}
                          dataPointsColor="#8B5CF6"
                          yAxisColor="#334155"
                          xAxisColor="#334155"
                          yAxisTextStyle={{ color: '#64748B', fontSize: 10 }}
                          xAxisLabelTextStyle={{ color: '#64748B', fontSize: 9 }}
                          hideRules
                          isAnimated
                          curved
                        />
                      )}
                    </View>

                    {/* Top Suppliers List */}
                    <View style={styles.topSuppliersCard}>
                      <View style={styles.topSuppliersHeader}>
                        <Ionicons name="list" size={24} color="#8B5CF6" />
                        <Text style={[styles.topSuppliersTitle, { flex: 1 }]}>
                          {supplierRankingType === 'amount' ? t('stats.topByAmount') :
                           supplierRankingType === 'frequency' ? t('stats.topByFrequency') : t('stats.topByAvg')}
                        </Text>
                        <TouchableOpacity
                          style={[styles.compareToggle, compareMode && styles.compareToggleActive]}
                          onPress={() => (compareMode ? exitCompareMode() : setCompareMode(true))}
                        >
                          <Ionicons name="git-compare" size={14} color={compareMode ? 'white' : '#8B5CF6'} />
                          <Text style={[styles.compareToggleText, compareMode && styles.compareToggleTextActive]}>
                            {t('stats.compare')}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {compareMode && (
                        <Text style={styles.compareHint}>{t('stats.compareHint')}</Text>
                      )}

                      {getCurrentRanking().length > 0 ? (
                        getCurrentRanking().map((supplier, index) => {
                          const isSelected = selectedForCompare.includes(supplier.supplier);
                          return (
                            <TouchableOpacity
                              key={supplier.supplier}
                              style={styles.supplierItem}
                              onPress={() => compareMode ? toggleCompareSelection(supplier.supplier) : setSelectedSupplier(supplier.supplier)}
                            >
                              {compareMode && (
                                <Ionicons
                                  name={isSelected ? 'checkbox' : 'square-outline'}
                                  size={20}
                                  color={isSelected ? '#8B5CF6' : '#64748B'}
                                  style={{ marginRight: 4 }}
                                />
                              )}
                              <View style={styles.supplierRank}>
                                <Text style={[
                                  styles.supplierRankText,
                                  index < 3 && { color: index === 0 ? '#F59E0B' : index === 1 ? '#94A3B8' : '#CD7F32' }
                                ]}>
                                  #{index + 1}
                                </Text>
                              </View>
                              <View style={styles.supplierInfo}>
                                <Text style={styles.supplierName} numberOfLines={1}>
                                  {supplier.supplier}
                                </Text>
                                <Text style={styles.supplierMeta}>
                                  {supplier.invoice_count} {t('stats.invoices')} • {t('stats.avgShort')} {supplier.avg_invoice.toFixed(0)}€
                                </Text>
                              </View>
                              <View style={styles.supplierAmounts}>
                                <Text style={styles.supplierAmount}>
                                  {supplier.total_amount.toFixed(2)} €
                                </Text>
                                <View style={styles.dependencyBadge}>
                                  <Text style={[
                                    styles.dependencyText,
                                    supplier.dependency_percent > 30 && { color: '#EF4444' }
                                  ]}>
                                    {supplier.dependency_percent.toFixed(0)}%
                                  </Text>
                                </View>
                              </View>
                              {!compareMode && <Ionicons name="chevron-forward" size={20} color="#64748B" />}
                            </TouchableOpacity>
                          );
                        })
                      ) : (
                        <Text style={styles.noDataText}>{t('stats.noSupplierData')}</Text>
                      )}
                    </View>

                    {compareMode && selectedForCompare.length >= 2 && (
                      <TouchableOpacity style={styles.compareFloatingButton} onPress={runCompareSuppliers}>
                        <Ionicons name="git-compare" size={20} color="white" />
                        <Text style={styles.compareFloatingButtonText}>
                          {t('stats.compareButtonWithCount')} ({selectedForCompare.length})
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* Inactive Suppliers Warning */}
                    {supplierOverview.inactive_suppliers.length > 0 && (
                      <View style={styles.inactiveCard}>
                        <View style={styles.inactiveHeader}>
                          <Ionicons name="time" size={24} color="#EF4444" />
                          <Text style={styles.inactiveTitle}>{t('stats.inactiveSuppliers')}</Text>
                        </View>
                        {supplierOverview.inactive_suppliers.slice(0, 5).map((supplier, index) => (
                          <TouchableOpacity 
                            key={supplier.supplier} 
                            style={styles.inactiveItem}
                            onPress={() => setSelectedSupplier(supplier.supplier)}
                          >
                            <View>
                              <Text style={styles.inactiveName}>{supplier.supplier}</Text>
                              <Text style={styles.inactiveMeta}>
                                {t('stats.lastDelivery')}: {supplier.last_delivery || t('stats.noValue')}
                              </Text>
                            </View>
                            <View style={styles.inactiveDays}>
                              <Text style={styles.inactiveDaysValue}>{supplier.days_inactive}</Text>
                              <Text style={styles.inactiveDaysLabel}>{t('stats.days')}</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    {/* High Dependency Alerts */}
                    {supplierOverview.high_dependency_alerts.length > 0 && (
                      <View style={styles.dependencyAlertCard}>
                        <View style={styles.dependencyAlertHeader}>
                          <Ionicons name="warning" size={24} color="#F59E0B" />
                          <Text style={styles.dependencyAlertTitle}>{t('stats.highDependency')}</Text>
                        </View>
                        <Text style={styles.dependencyAlertDesc}>{t('stats.highDependencyDesc')}</Text>
                        {supplierOverview.high_dependency_alerts.map((supplier, index) => (
                          <View key={supplier.supplier} style={styles.dependencyAlertItem}>
                            <Text style={styles.dependencyAlertName}>{supplier.supplier}</Text>
                            <Text style={styles.dependencyAlertPercent}>{supplier.dependency_percent.toFixed(1)}%</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                ) : (
                  <View style={styles.noDataContainer}>
                    <Ionicons name="business-outline" size={48} color="#64748B" />
                    <Text style={styles.noDataText}>{t('stats.noSupplierData')}</Text>
                  </View>
                )}
                <View style={{ height: 40 }} />
              </View>
            ) : activeTab === 'items' ? (
              /* ========== ITEMS TAB ========== */
              <View style={styles.suppliersContainer}>
                {loadingItems ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#8B5CF6" />
                    <Text style={styles.loadingText}>{t('stats.loadingData')}</Text>
                  </View>
                ) : (
                  <>
                    {/* Price Alerts Section */}
                    {priceAlerts.length > 0 && (
                      <View style={styles.priceAlertsCard}>
                        <View style={styles.priceAlertsHeader}>
                          <Ionicons name="alert-circle" size={24} color="#EF4444" />
                          <Text style={styles.priceAlertsTitle}>{t('stats.priceAlerts')}</Text>
                          {unreadAlerts > 0 && (
                            <View style={styles.alertCountBadge}>
                              <Text style={styles.alertCountText}>{unreadAlerts}</Text>
                            </View>
                          )}
                        </View>
                        
                        {priceAlerts.filter(a => a.status !== 'dismissed').slice(0, 5).map((alert) => (
                          <View 
                            key={alert.id} 
                            style={[styles.alertItem, alert.status === 'unread' && styles.alertItemUnread]}
                          >
                            <View style={styles.alertInfo}>
                              <Text style={styles.alertItemName} numberOfLines={1}>{alert.item_name}</Text>
                              <Text style={styles.alertSupplier}>{alert.supplier}</Text>
                              <View style={styles.alertPrices}>
                                <Text style={styles.alertOldPrice}>{alert.old_price.toFixed(2)}€</Text>
                                <Ionicons name="arrow-forward" size={14} color="#64748B" />
                                <Text style={styles.alertNewPrice}>{alert.new_price.toFixed(2)}€</Text>
                                <View style={styles.alertChangeBadge}>
                                  <Text style={styles.alertChangeText}>+{alert.change_percent}%</Text>
                                </View>
                              </View>
                            </View>
                            <View style={styles.alertActions}>
                              {alert.status === 'unread' && (
                                <TouchableOpacity 
                                  style={styles.alertActionBtn}
                                  onPress={() => markAlertAsRead(alert.id)}
                                >
                                  <Ionicons name="checkmark" size={18} color="#10B981" />
                                </TouchableOpacity>
                              )}
                              <TouchableOpacity 
                                style={styles.alertActionBtn}
                                onPress={() => dismissAlert(alert.id)}
                              >
                                <Ionicons name="close" size={18} color="#EF4444" />
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Item Totals */}
                    {itemStats && (
                      <View style={styles.supplierTotalsCard}>
                        <Text style={styles.supplierTotalsTitle}>{t('stats.itemsTitle')}</Text>
                        <View style={styles.supplierTotalsRow}>
                          <View style={styles.supplierTotalItem}>
                            <Text style={styles.supplierTotalValue}>
                              {itemStats.totals?.unique_items || 0}
                            </Text>
                            <Text style={styles.supplierTotalLabel}>{t('stats.uniqueItems')}</Text>
                          </View>
                          <View style={styles.supplierTotalItem}>
                            <Text style={styles.supplierTotalValue}>
                              {(itemStats.totals?.total_value || 0).toFixed(0)} €
                            </Text>
                            <Text style={styles.supplierTotalLabel}>{t('stats.totalValue')}</Text>
                          </View>
                        </View>
                      </View>
                    )}

                    {/* Price Inflation Card */}
                    <View style={styles.inflationCard}>
                      <View style={styles.priceAlertsHeader}>
                        <Ionicons name="analytics" size={24} color="#F59E0B" />
                        <Text style={styles.inflationTitle}>{t('stats.priceInflation')}</Text>
                      </View>

                      <View style={styles.rankingSelector}>
                        {(['month', 'quarter', 'year'] as const).map((p) => (
                          <TouchableOpacity
                            key={p}
                            style={[styles.rankingButton, inflationPeriod === p && styles.rankingButtonActive]}
                            onPress={() => setInflationPeriod(p)}
                          >
                            <Text style={[styles.rankingButtonText, inflationPeriod === p && styles.rankingButtonTextActive]}>
                              {t(`stats.inflationPeriod.${p}`)}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      {loadingInflation ? (
                        <ActivityIndicator size="small" color="#F59E0B" style={{ marginVertical: 16 }} />
                      ) : inflationData && inflationData.items_compared > 0 ? (
                        <>
                          <View style={styles.inflationHeadline}>
                            <Text style={[
                              styles.inflationHeadlineValue,
                              { color: inflationData.overall_change_percent > 0 ? '#EF4444' : inflationData.overall_change_percent < 0 ? '#10B981' : '#94A3B8' }
                            ]}>
                              {inflationData.overall_change_percent > 0 ? '+' : ''}{inflationData.overall_change_percent}%
                            </Text>
                            <Text style={styles.inflationHeadlineLabel}>
                              {t('stats.inflationHeadline')} ({inflationData.items_compared} {t('stats.inflationItemsCompared')})
                            </Text>
                          </View>

                          <TouchableOpacity
                            style={styles.inflationToggle}
                            onPress={() => setInflationExpanded(!inflationExpanded)}
                          >
                            <Text style={styles.inflationToggleText}>
                              {inflationExpanded ? t('stats.inflationHideDetails') : t('stats.inflationShowDetails')}
                            </Text>
                            <Ionicons name={inflationExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#F59E0B" />
                          </TouchableOpacity>

                          {inflationExpanded && inflationData.items.map((item: any) => (
                            <View key={item.item_name} style={styles.alertItem}>
                              <View style={styles.alertInfo}>
                                <Text style={styles.alertItemName} numberOfLines={1}>{item.item_name}</Text>
                                <Text style={styles.alertSupplier}>{item.supplier} • {item.purchase_count}x</Text>
                                <View style={styles.alertPrices}>
                                  <Text style={styles.alertOldPrice}>{item.start_price.toFixed(2)}€</Text>
                                  <Ionicons name="arrow-forward" size={14} color="#64748B" />
                                  <Text style={[styles.alertNewPrice, { color: item.change_percent >= 0 ? '#EF4444' : '#10B981' }]}>
                                    {item.end_price.toFixed(2)}€
                                  </Text>
                                  <View style={[styles.alertChangeBadge, { backgroundColor: item.change_percent >= 0 ? '#EF444420' : '#10B98120' }]}>
                                    <Text style={[styles.alertChangeText, { color: item.change_percent >= 0 ? '#EF4444' : '#10B981' }]}>
                                      {item.change_percent > 0 ? '+' : ''}{item.change_percent}%
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            </View>
                          ))}
                        </>
                      ) : (
                        <Text style={styles.inflationNoData}>{t('stats.inflationNoData')}</Text>
                      )}
                    </View>

                    {/* Ranking Type Selector */}
                    <View style={styles.rankingSelector}>
                      <TouchableOpacity
                        style={[styles.rankingButton, itemRankingType === 'value' && styles.rankingButtonActive]}
                        onPress={() => setItemRankingType('value')}
                      >
                        <Text style={[styles.rankingButtonText, itemRankingType === 'value' && styles.rankingButtonTextActive]}>
                          {t('stats.topByValue')}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.rankingButton, itemRankingType === 'quantity' && styles.rankingButtonActive]}
                        onPress={() => setItemRankingType('quantity')}
                      >
                        <Text style={[styles.rankingButtonText, itemRankingType === 'quantity' && styles.rankingButtonTextActive]}>
                          {t('stats.topByQuantity')}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.rankingButton, itemRankingType === 'frequency' && styles.rankingButtonActive]}
                        onPress={() => setItemRankingType('frequency')}
                      >
                        <Text style={[styles.rankingButtonText, itemRankingType === 'frequency' && styles.rankingButtonTextActive]}>
                          {t('stats.byFrequency')}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Items Ranking List */}
                    <View style={styles.topSuppliersCard}>
                      <View style={styles.topSuppliersHeader}>
                        <Ionicons name="pricetags" size={24} color="#8B5CF6" />
                        <Text style={styles.topSuppliersTitle}>
                          {itemRankingType === 'value' ? t('stats.topByValue') : 
                           itemRankingType === 'quantity' ? t('stats.topByQuantity') : t('stats.byFrequency')}
                        </Text>
                      </View>
                      
                      {getCurrentItemRanking().length > 0 ? (
                        getCurrentItemRanking().map((item: any, index: number) => (
                          <TouchableOpacity 
                            key={item.item_name} 
                            style={styles.supplierItem}
                            onPress={() => setSelectedItem(item.item_name)}
                          >
                            <View style={styles.supplierRank}>
                              <Text style={[
                                styles.supplierRankText,
                                index < 3 && { color: index === 0 ? '#F59E0B' : index === 1 ? '#94A3B8' : '#CD7F32' }
                              ]}>
                                #{index + 1}
                              </Text>
                            </View>
                            <View style={styles.supplierInfo}>
                              <Text style={styles.supplierName} numberOfLines={1}>
                                {item.item_name}
                              </Text>
                              <Text style={styles.supplierMeta}>
                                {item.frequency} {t('stats.invoices')} • {item.supplier_count} {t('stats.suppliersLower')}
                              </Text>
                            </View>
                            <View style={styles.supplierAmounts}>
                              <Text style={styles.supplierAmount}>
                                {itemRankingType === 'quantity' 
                                  ? `${item.quantity.toFixed(1)} ${t('units.pieces')}`
                                  : `${item.total_value.toFixed(2)} €`}
                              </Text>
                              <View style={styles.itemTrendBadge}>
                                <Ionicons 
                                  name={item.trend_percent > 0 ? "trending-up" : item.trend_percent < 0 ? "trending-down" : "remove"} 
                                  size={12} 
                                  color={item.trend_percent > 5 ? '#EF4444' : item.trend_percent < -5 ? '#10B981' : '#64748B'} 
                                />
                                <Text style={[
                                  styles.itemTrendText,
                                  { color: item.trend_percent > 5 ? '#EF4444' : item.trend_percent < -5 ? '#10B981' : '#64748B' }
                                ]}>
                                  {item.trend_percent > 0 ? '+' : ''}{item.trend_percent.toFixed(0)}%
                                </Text>
                              </View>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color="#64748B" />
                          </TouchableOpacity>
                        ))
                      ) : (
                        <View style={styles.noDataContainer}>
                          <Ionicons name="pricetags-outline" size={48} color="#64748B" />
                          <Text style={styles.noDataText}>{t('stats.noItems')}</Text>
                        </View>
                      )}
                    </View>

                    {/* Price Trends Section */}
                    {itemStats?.price_trends?.length > 0 && (
                      <View style={styles.dependencyAlertCard}>
                        <View style={styles.dependencyAlertHeader}>
                          <Ionicons name="trending-up" size={24} color="#F59E0B" />
                          <Text style={styles.dependencyAlertTitle}>{t('stats.priceTrends')}</Text>
                        </View>
                        <Text style={styles.dependencyAlertDesc}>
                          {t('stats.priceTrendsDesc')}
                        </Text>
                        {itemStats.price_trends.slice(0, 5).map((item: any) => (
                          <TouchableOpacity 
                            key={item.item_name} 
                            style={styles.dependencyAlertItem}
                            onPress={() => setSelectedItem(item.item_name)}
                          >
                            <Text style={styles.dependencyAlertName} numberOfLines={1}>{item.item_name}</Text>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={[
                                styles.dependencyAlertPercent,
                                { color: item.trend_percent > 0 ? '#EF4444' : '#10B981' }
                              ]}>
                                {item.trend_percent > 0 ? '+' : ''}{item.trend_percent.toFixed(1)}%
                              </Text>
                              <Text style={styles.itemAvgPrice}>{t('stats.avgPrice')}: {item.avg_price.toFixed(2)}€</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </>
                )}
                <View style={{ height: 40 }} />
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </View>
      
      {/* Supplier Detail Modal */}
      {renderSupplierDetailModal()}

      {/* Supplier Compare Modal */}
      {renderCompareModal()}

      {/* Item Detail Modal */}
      <Modal
        visible={!!selectedItem}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setSelectedItem(null);
          setItemPriceHistory(null);
          setItemBySupplier(null);
        }}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity 
              style={styles.modalCloseButton}
              onPress={() => {
                setSelectedItem(null);
                setItemPriceHistory(null);
                setItemBySupplier(null);
              }}
            >
              <Ionicons name="close" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.modalTitle} numberOfLines={1}>{selectedItem}</Text>
            <View style={{ width: 40 }} />
          </View>

          {loadingItemDetail ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator size="large" color="#8B5CF6" />
            </View>
          ) : (
            <ScrollView style={styles.modalContent}>
              {/* Item Statistics */}
              {itemPriceHistory?.statistics && (
                <View style={styles.detailCard}>
                  <Text style={styles.detailCardTitle}>{t('stats.priceHistory')}</Text>
                  <View style={styles.detailGrid}>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailValue}>{itemPriceHistory.statistics.avg_price}€</Text>
                      <Text style={styles.detailLabel}>{t('stats.avgPrice')}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailValue}>{itemPriceHistory.statistics.min_price}€</Text>
                      <Text style={styles.detailLabel}>{t('stats.minPrice')}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailValue}>{itemPriceHistory.statistics.max_price}€</Text>
                      <Text style={styles.detailLabel}>{t('stats.maxPrice')}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <Text style={[styles.detailValue, { 
                        color: itemPriceHistory.statistics.trend_percent > 5 ? '#EF4444' : 
                               itemPriceHistory.statistics.trend_percent < -5 ? '#10B981' : '#8B5CF6'
                      }]}>
                        {itemPriceHistory.statistics.trend_percent > 0 ? '+' : ''}{itemPriceHistory.statistics.trend_percent}%
                      </Text>
                      <Text style={styles.detailLabel}>{t('stats.priceTrends')}</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Price History Chart */}
              {itemPriceHistory?.history?.length > 0 && (
                <View style={styles.detailCard}>
                  <Text style={styles.detailCardTitle}>{t('stats.monthlyTrend')}</Text>
                  <LineChart
                    data={itemPriceHistory.history.slice(-10).map((h: any) => ({
                      value: h.unit_price,
                      label: h.date.substring(5),
                      dataPointColor: '#8B5CF6',
                    }))}
                    width={chartWidth - 20}
                    height={150}
                    color="#8B5CF6"
                    thickness={2}
                    dataPointsColor="#8B5CF6"
                    yAxisColor="#334155"
                    xAxisColor="#334155"
                    yAxisTextStyle={{ color: '#64748B', fontSize: 10 }}
                    xAxisLabelTextStyle={{ color: '#64748B', fontSize: 9 }}
                    hideRules
                    isAnimated
                    curved
                  />
                </View>
              )}

              {/* Supplier Comparison */}
              {itemBySupplier?.suppliers?.length > 0 && (
                <View style={styles.detailCard}>
                  <Text style={styles.detailCardTitle}>{t('stats.supplierCompare')}</Text>
                  
                  {/* Recommendation */}
                  {itemBySupplier.recommendation && (
                    <View style={styles.recommendationBanner}>
                      <Ionicons name="bulb" size={20} color="#10B981" />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={styles.recommendationTitle}>{t('stats.bestSupplier')}</Text>
                        <Text style={styles.recommendationText}>
                          {itemBySupplier.recommendation.best_supplier} - {itemBySupplier.recommendation.avg_price}€
                        </Text>
                        <Text style={styles.recommendationSavings}>
                          {t('stats.potentialSavings')}: {itemBySupplier.recommendation.potential_savings_percent}%
                        </Text>
                      </View>
                    </View>
                  )}
                  
                  {itemBySupplier.suppliers.map((sup: any, index: number) => (
                    <View key={sup.supplier} style={styles.supplierCompareItem}>
                      <View style={styles.supplierCompareRank}>
                        <Text style={[
                          styles.supplierCompareRankText,
                          index === 0 && { color: '#10B981' }
                        ]}>
                          #{index + 1}
                        </Text>
                      </View>
                      <View style={styles.supplierCompareInfo}>
                        <Text style={styles.supplierCompareName} numberOfLines={1}>{sup.supplier}</Text>
                        <Text style={styles.supplierCompareMeta}>
                          {sup.purchase_count} {t('stats.times')} • {t('stats.lastDelivery')}: {sup.last_purchase || t('stats.noValue')}
                        </Text>
                      </View>
                      <View style={styles.supplierComparePrices}>
                        <Text style={styles.supplierComparePrice}>{sup.avg_price}€</Text>
                        <Text style={styles.supplierComparePriceLabel}>{t('stats.avgPrice')}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Recent Price History */}
              {itemPriceHistory?.history?.length > 0 && (
                <View style={styles.detailCard}>
                  <Text style={styles.detailCardTitle}>{t('stats.recentInvoices')}</Text>
                  {itemPriceHistory.history.slice(-5).reverse().map((h: any, index: number) => (
                    <View key={index} style={styles.recentInvoiceItem}>
                      <View>
                        <Text style={styles.recentInvoiceNumber}>№{h.invoice_number}</Text>
                        <Text style={styles.recentInvoiceDate}>{h.date} • {h.supplier}</Text>
                      </View>
                      <Text style={styles.recentInvoiceAmount}>{h.unit_price.toFixed(2)}€</Text>
                    </View>
                  ))}
                </View>
              )}
              
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </Modal>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  header: {
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  exportButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
  },
  periodSelector: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  periodButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  periodButtonActive: {
    backgroundColor: '#8B5CF6',
  },
  periodButtonText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
  },
  periodButtonTextActive: {
    color: 'white',
  },
  avgTurnoverStatCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  avgTurnoverStatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  avgTurnoverStatTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    flex: 1,
  },
  avgTurnoverStatValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#3B82F6',
    marginBottom: 4,
  },
  avgTurnoverStatSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  summaryCard: {
    width: '47%',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
  },
  cardLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 8,
  },
  cardValue: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 4,
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 6,
  },
  trendBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  chartContainer: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  noDataContainer: {
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    color: '#64748B',
    fontSize: 14,
  },
  vatBreakdown: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 16,
  },
  vatRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  vatItem: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
  },
  vatLabel: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 4,
  },
  vatValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  vatTotal: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  vatTotalLabel: {
    fontSize: 14,
    color: 'white',
    fontWeight: '500',
  },
  vatTotalValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  additionalStats: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
  },
  statRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statItem: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 8,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 4,
  },
  top3Section: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
  },
  top3Row: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  top3Column: {
    flex: 1,
  },
  top3ColumnTitle: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  top3Item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
    gap: 8,
  },
  top3Rank: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#8B5CF6',
    width: 14,
  },
  top3Name: {
    flex: 1,
    fontSize: 12,
    color: '#E2E8F0',
  },
  top3Value: {
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
  },
  forecastSection: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
  },
  forecastHint: {
    fontSize: 12,
    color: '#64748B',
    marginTop: -4,
    marginBottom: 12,
  },
  forecastRow: {
    flexDirection: 'row',
    gap: 12,
  },
  forecastCard: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  forecastLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 6,
    textAlign: 'center',
  },
  forecastValue: {
    fontSize: 17,
    fontWeight: 'bold',
    marginTop: 4,
  },
  forecastTrend: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
  },
  tabSelector: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 10,
    gap: 4,
  },
  tabButtonActive: {
    backgroundColor: '#8B5CF6',
  },
  tabButtonText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
    textAlign: 'center',
  },
  tabButtonTextActive: {
    color: 'white',
  },
  suppliersContainer: {
    flex: 1,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    color: '#64748B',
    marginTop: 12,
  },
  
  // Executive Summary
  executiveSummaryCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  execSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  execSummaryTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  execSummaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  execItem: {
    alignItems: 'center',
  },
  execValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  execLabel: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
  concentrationRow: {
    marginBottom: 12,
  },
  concentrationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  concentrationLabel: {
    fontSize: 12,
    color: '#64748B',
    width: 100,
  },
  concentrationBar: {
    flex: 1,
    height: 8,
    backgroundColor: '#0F172A',
    borderRadius: 4,
    overflow: 'hidden',
  },
  concentrationFill: {
    height: '100%',
    borderRadius: 4,
  },
  concentrationValue: {
    fontSize: 12,
    color: 'white',
    fontWeight: 'bold',
    width: 50,
    textAlign: 'right',
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F59E0B20',
    padding: 12,
    borderRadius: 8,
  },
  alertText: {
    color: '#F59E0B',
    fontSize: 13,
    flex: 1,
  },
  
  // Supplier Totals
  supplierTotalsCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  supplierTotalsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 16,
    textAlign: 'center',
  },
  supplierTotalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  supplierTotalItem: {
    alignItems: 'center',
  },
  supplierTotalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  supplierTotalLabel: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
  
  // Chart Controls
  chartControlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  chartTypeSelector: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 4,
  },
  chartTypeButton: {
    padding: 10,
    borderRadius: 6,
  },
  chartTypeButtonActive: {
    backgroundColor: '#8B5CF6',
  },
  rankingSelector: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 4,
  },
  rankingButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  rankingButtonActive: {
    backgroundColor: '#8B5CF6',
  },
  rankingButtonText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
  },
  rankingButtonTextActive: {
    color: 'white',
  },
  
  // Pie Chart
  pieChartContainer: {
    alignItems: 'center',
  },
  pieCenter: {
    alignItems: 'center',
  },
  pieCenterValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  pieCenterLabel: {
    fontSize: 10,
    color: '#64748B',
  },
  legendContainer: {
    marginTop: 16,
    width: '100%',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  legendColor: {
    width: 12,
    height: 12,
    borderRadius: 3,
    marginRight: 8,
  },
  legendText: {
    flex: 1,
    color: 'white',
    fontSize: 13,
  },
  legendValue: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: 'bold',
  },
  
  // Top Suppliers
  topSuppliersCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  topSuppliersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  topSuppliersTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  compareToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  compareToggleActive: {
    backgroundColor: '#8B5CF6',
  },
  compareToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8B5CF6',
  },
  compareToggleTextActive: {
    color: 'white',
  },
  compareHint: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 12,
  },
  compareFloatingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 12,
  },
  compareFloatingButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '700',
  },
  compareCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  compareSupplierName: {
    fontSize: 15,
    fontWeight: '700',
    color: 'white',
    marginBottom: 10,
  },
  compareBarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  compareBarLabel: {
    fontSize: 12,
    color: '#94A3B8',
  },
  compareBarValue: {
    fontSize: 13,
    fontWeight: '600',
    color: 'white',
  },
  compareBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0F172A',
    overflow: 'hidden',
    marginBottom: 12,
  },
  compareBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  compareStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  compareStatItem: {
    alignItems: 'center',
  },
  compareStatLabel: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 2,
  },
  compareStatValue: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  supplierItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  supplierRank: {
    width: 32,
    alignItems: 'center',
  },
  supplierRankText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#64748B',
  },
  supplierInfo: {
    flex: 1,
    marginLeft: 8,
  },
  supplierName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  supplierMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  supplierAmounts: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  supplierAmount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#10B981',
  },
  dependencyBadge: {
    backgroundColor: '#8B5CF620',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  dependencyText: {
    fontSize: 10,
    color: '#8B5CF6',
    fontWeight: 'bold',
  },
  
  // Inactive Suppliers
  inactiveCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#EF4444',
  },
  inactiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  inactiveTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#EF4444',
  },
  inactiveItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  inactiveName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  inactiveMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  inactiveDays: {
    alignItems: 'center',
  },
  inactiveDaysValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#EF4444',
  },
  inactiveDaysLabel: {
    fontSize: 10,
    color: '#64748B',
  },
  
  // High Dependency Alert
  dependencyAlertCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  dependencyAlertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  dependencyAlertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F59E0B',
  },
  dependencyAlertDesc: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 12,
  },
  dependencyAlertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  dependencyAlertName: {
    fontSize: 14,
    color: 'white',
  },
  dependencyAlertPercent: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F59E0B',
  },
  
  // Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  modalCloseButton: {
    padding: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    flex: 1,
    textAlign: 'center',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  modalLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Detail Card
  detailCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  detailCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 16,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  detailItem: {
    width: '47%',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  detailValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  detailLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 4,
  },
  detailDates: {
    marginTop: 16,
  },
  detailDateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  detailDateLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  detailDateValue: {
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  
  // Anomaly
  anomalyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  anomalyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  anomalyInvoice: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  anomalyDate: {
    fontSize: 11,
    color: '#64748B',
  },
  anomalyAmount: {
    alignItems: 'flex-end',
  },
  anomalyValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#F59E0B',
  },
  anomalyDeviation: {
    fontSize: 10,
    color: '#EF4444',
    fontWeight: 'bold',
  },
  
  // Recent Invoices
  recentInvoiceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  recentInvoiceNumber: {
    fontSize: 14,
    fontWeight: '500',
    color: 'white',
  },
  recentInvoiceDate: {
    fontSize: 11,
    color: '#64748B',
  },
  recentInvoiceAmount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#10B981',
  },
  
  // Alert Badge on Tab
  alertBadge: {
    position: 'absolute',
    top: -5,
    right: -8,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  
  // Price Alerts Card
  priceAlertsCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#EF4444',
  },
  priceAlertsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  priceAlertsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#EF4444',
    flex: 1,
  },
  alertCountBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  alertCountText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  alertItemUnread: {
    borderLeftWidth: 3,
    borderLeftColor: '#EF4444',
  },
  alertInfo: {
    flex: 1,
  },
  alertItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  alertSupplier: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  alertPrices: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  alertOldPrice: {
    fontSize: 12,
    color: '#64748B',
    textDecorationLine: 'line-through',
  },
  alertNewPrice: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#EF4444',
  },
  alertChangeBadge: {
    backgroundColor: '#EF444420',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  alertChangeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#EF4444',
  },
  alertActions: {
    flexDirection: 'row',
    gap: 8,
  },
  alertActionBtn: {
    padding: 8,
    backgroundColor: '#1E293B',
    borderRadius: 8,
  },

  // Price Inflation Card
  inflationCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  inflationTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F59E0B',
    flex: 1,
  },
  inflationHeadline: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  inflationHeadlineValue: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  inflationHeadlineLabel: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 4,
    textAlign: 'center',
  },
  inflationToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  inflationToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F59E0B',
  },
  inflationNoData: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    paddingVertical: 16,
  },

  // Item Trend Badge
  itemTrendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0F172A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  itemTrendText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  itemAvgPrice: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  
  // Recommendation Banner
  recommendationBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#10B98120',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  recommendationTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#10B981',
  },
  recommendationText: {
    fontSize: 14,
    color: 'white',
    marginTop: 2,
  },
  recommendationSavings: {
    fontSize: 11,
    color: '#10B981',
    marginTop: 4,
  },
  
  // Supplier Compare
  supplierCompareItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  supplierCompareRank: {
    width: 30,
    alignItems: 'center',
  },
  supplierCompareRankText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#64748B',
  },
  supplierCompareInfo: {
    flex: 1,
    marginLeft: 8,
  },
  supplierCompareName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  supplierCompareMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  supplierComparePrices: {
    alignItems: 'flex-end',
  },
  supplierComparePrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  supplierComparePriceLabel: {
    fontSize: 10,
    color: '#64748B',
  },
});
