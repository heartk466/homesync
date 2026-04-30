import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, Tooltip
} from 'recharts';
import { Search, Filter, X, ChevronDown, FileText, Eye, Download } from 'lucide-react';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import './ReportsScreen.css';

const COLORS = ['#3B2AAB', '#AE96FF', '#D4C5FF', '#6B46C1', '#9F7AEA'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function ReportsScreen() {
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [household, setHousehold] = useState(null);
  const [allHouseholds, setAllHouseholds] = useState([]);
  const [selectedHousehold, setSelectedHousehold] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Data
  const [yearlyTotal, setYearlyTotal] = useState(0);
  const [lastYearTotal, setLastYearTotal] = useState(0);
  const [monthlyData, setMonthlyData] = useState([]);
  const [categoryData, setCategoryData] = useState([]);
  const [pendingBalances, setPendingBalances] = useState(0);
  const [lastYearPending, setLastYearPending] = useState(0);
  const [pendingByCategory, setPendingByCategory] = useState([]);
  const [statementHistory, setStatementHistory] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [reportSchedule, setReportSchedule] = useState(null);

  // UI State
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showStatementDetail, setShowStatementDetail] = useState(false);
  const [selectedStatement, setSelectedStatement] = useState(null);
  const [showHouseholdDropdown, setShowHouseholdDropdown] = useState(false);
  const [householdSearch, setHouseholdSearch] = useState('');
  const [activeTab, setActiveTab] = useState('generate');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  // Generate Report Form
  const [reportForm, setReportForm] = useState({
    expense_range: new Date().toISOString().split('T')[0],
    category_filter: [],
    group_filter: '',
    member_split: 'total',
  });

  // Schedule Form
  const [scheduleForm, setScheduleForm] = useState({
    frequency: 'monthly',
    day_of_month: 1,
    custom_interval_days: 30,
    category_filter: [],
  });

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }
      setCurrentUser(user);

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);

      const { data: memberData } = await supabase
        .from('household_members')
        .select('*, households(*)')
        .eq('user_id', user.id);

      const households = memberData?.map(m => ({
        ...m.households,
        role: m.role,
      })) || [];
      setAllHouseholds(households);

      const primary = households.find(h => h.id === profileData.household_id)
        || households[0];
      setHousehold(primary);
      setSelectedHousehold(primary);
      setReportForm(prev => ({ ...prev, group_filter: primary?.name || '' }));

      await fetchReportData(primary, user);
      await fetchNotifications(user.id);

      const { data: schedule } = await supabase
        .from('report_schedules')
        .select('*')
        .eq('user_id', user.id)
        .eq('household_id', primary?.id)
        .single();
      if (schedule) {
        setReportSchedule(schedule);
        setScheduleForm({
          frequency: schedule.frequency,
          day_of_month: schedule.day_of_month,
          custom_interval_days: schedule.custom_interval_days || 30,
          category_filter: schedule.category_filter || [],
        });
      }

    } catch (err) {
      console.error(err);
    }
  };

  const fetchReportData = async (houseData, user) => {
    if (!houseData) return;

    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
    const yearEnd = new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0];
    const lastYearStart = new Date(now.getFullYear() - 1, 0, 1).toISOString().split('T')[0];
    const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31).toISOString().split('T')[0];

    // Fetch this year expenses
    const { data: thisYearExpenses } = await supabase
      .from('expenses')
      .select('*')
      .eq('household_id', houseData.id)
      .eq('approval_status', 'approved')
      .gte('expense_date', yearStart)
      .lte('expense_date', yearEnd);

    // Fetch last year expenses
    const { data: lastYearExpenses } = await supabase
      .from('expenses')
      .select('*')
      .eq('household_id', houseData.id)
      .eq('approval_status', 'approved')
      .gte('expense_date', lastYearStart)
      .lte('expense_date', lastYearEnd);

    // Yearly total
    const total = (thisYearExpenses || [])
      .reduce((sum, e) => sum + Number(e.amount), 0);
    setYearlyTotal(total);

    const lastTotal = (lastYearExpenses || [])
      .reduce((sum, e) => sum + Number(e.amount), 0);
    setLastYearTotal(lastTotal);

    // Monthly data for bar chart
    const monthly = MONTHS.map((month, i) => {
      const monthExpenses = (thisYearExpenses || []).filter(e => {
        const d = new Date(e.expense_date);
        return d.getMonth() === i;
      });
      return {
        month,
        amount: monthExpenses.reduce((sum, e) => sum + Number(e.amount), 0),
      };
    });
    setMonthlyData(monthly);

    // Category breakdown
    const categories = {};
    (thisYearExpenses || []).forEach(e => {
      categories[e.category] = (categories[e.category] || 0) + Number(e.amount);
    });
    setCategoryData(
      Object.entries(categories)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
    );

    // Pending balances
    const pending = (thisYearExpenses || [])
      .filter(e => e.status === 'pending' || e.status === 'unpaid')
      .reduce((sum, e) => sum + Number(e.amount), 0);
    setPendingBalances(pending);

    const lastPending = (lastYearExpenses || [])
      .filter(e => e.status === 'pending' || e.status === 'unpaid')
      .reduce((sum, e) => sum + Number(e.amount), 0);
    setLastYearPending(lastPending);

    // Pending by category
    const pendingCats = {};
    (thisYearExpenses || [])
      .filter(e => e.status === 'pending' || e.status === 'unpaid')
      .forEach(e => {
        pendingCats[e.category] = (pendingCats[e.category] || 0) + Number(e.amount);
      });
    setPendingByCategory(
      Object.entries(pendingCats).map(([name, value]) => ({ name, value }))
    );

    // Statement history — group by month
    const monthlyStatements = {};
    (thisYearExpenses || []).forEach(e => {
      const d = new Date(e.expense_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyStatements[key]) {
        monthlyStatements[key] = {
          id: key,
          period: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
          expenses: [],
          total: 0,
          createdDate: e.created_at,
        };
      }
      monthlyStatements[key].expenses.push(e);
      monthlyStatements[key].total += Number(e.amount);
    });

    const statements = Object.values(monthlyStatements)
      .sort((a, b) => b.id.localeCompare(a.id));
    setStatementHistory(statements);

    // Recent activity
    const { data: activity } = await supabase
      .from('report_activity')
      .select('*, profiles(*)')
      .eq('household_id', houseData.id)
      .order('created_at', { ascending: false })
      .limit(10);
    setRecentActivity(activity || []);
  };

  const fetchNotifications = async (userId) => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    setNotifications(data || []);
    setUnreadCount((data || []).filter(n => !n.is_read).length);
  };

  const markAllRead = async () => {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', currentUser.id)
      .eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getYoYChange = (current, last) => {
    if (last === 0) return null;
    return (((current - last) / last) * 100).toFixed(1);
  };

  const handleSwitchHousehold = async (h) => {
    setSelectedHousehold(h);
    setShowHouseholdDropdown(false);
    setHouseholdSearch('');
    await fetchReportData(h, currentUser);
    showToast(`Switched to ${h.name}`);
  };

  const handleGenerateReport = async () => {
    setLoading(true);
    try {
      await supabase.from('report_activity').insert({
        user_id: currentUser.id,
        household_id: selectedHousehold?.id,
        action: 'generated',
        description: `${profile?.full_name} generated a report for ${selectedHousehold?.name}`,
      });
      showToast('Report generated! ✅');
      setShowGenerateModal(false);
      await fetchReportData(selectedHousehold, currentUser);
    } catch {
      showToast('Failed to generate report.', 'error');
    }
    setLoading(false);
  };

  const handleExportPDF = async (statement) => {
    try {
      const doc = new jsPDF();

      // Header
      doc.setFontSize(20);
      doc.setTextColor(59, 42, 171);
      doc.text('HomeSync Report', 14, 20);

      doc.setFontSize(12);
      doc.setTextColor(100);
      doc.text(`Household: ${selectedHousehold?.name || ''}`, 14, 30);
      doc.text(`Period: ${statement?.period || 'Full Year'}`, 14, 38);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 46);

      // Summary
      doc.setFontSize(14);
      doc.setTextColor(59, 42, 171);
      doc.text('Summary', 14, 58);

      const expenses = statement?.expenses || [];
      const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
      const paid = expenses.filter(e => e.status === 'paid').reduce((sum, e) => sum + Number(e.amount), 0);
      const pending = expenses.filter(e => e.status === 'pending').reduce((sum, e) => sum + Number(e.amount), 0);

      autoTable(doc, {
        startY: 62,
        head: [['Total Expenses', 'Paid', 'Pending']],
        body: [[
          `₱${total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
          `₱${paid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
          `₱${pending.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        ]],
        styles: { font: 'helvetica', fontSize: 10 },
        headStyles: { fillColor: [59, 42, 171] },
      });

      // Expense List
      doc.setFontSize(14);
      doc.setTextColor(59, 42, 171);
      doc.text('Expense Details', 14, doc.lastAutoTable.finalY + 14);

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 18,
        head: [['Title', 'Category', 'Amount', 'Date', 'Status']],
        body: expenses.map(e => [
          e.title,
          e.category,
          `₱${Number(e.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
          e.expense_date,
          e.status,
        ]),
        styles: { font: 'helvetica', fontSize: 9 },
        headStyles: { fillColor: [59, 42, 171] },
      });

      doc.save(`HomeSync-Report-${statement?.period || 'Full-Year'}.pdf`);

      // Log activity
      await supabase.from('report_activity').insert({
        user_id: currentUser.id,
        household_id: selectedHousehold?.id,
        action: 'exported',
        description: `${profile?.full_name} exported "${selectedHousehold?.name}" Statement`,
      });

      showToast('PDF exported! ✅');
      await fetchReportData(selectedHousehold, currentUser);
    } catch (err) {
      console.error(err);
      showToast('Failed to export PDF.', 'error');
    }
  };

  const handleSaveSchedule = async () => {
    setLoading(true);
    try {
      const nextDate = new Date();
      if (scheduleForm.frequency === 'monthly') {
        nextDate.setMonth(nextDate.getMonth() + 1);
        nextDate.setDate(scheduleForm.day_of_month);
      } else {
        nextDate.setDate(nextDate.getDate() + scheduleForm.custom_interval_days);
      }

      if (reportSchedule) {
        await supabase
          .from('report_schedules')
          .update({
            frequency: scheduleForm.frequency,
            day_of_month: scheduleForm.day_of_month,
            custom_interval_days: scheduleForm.custom_interval_days,
            category_filter: scheduleForm.category_filter,
            next_scheduled_at: nextDate.toISOString(),
            is_active: true,
          })
          .eq('id', reportSchedule.id);
      } else {
        await supabase.from('report_schedules').insert({
          user_id: currentUser.id,
          household_id: selectedHousehold?.id,
          frequency: scheduleForm.frequency,
          day_of_month: scheduleForm.day_of_month,
          custom_interval_days: scheduleForm.custom_interval_days,
          category_filter: scheduleForm.category_filter,
          next_scheduled_at: nextDate.toISOString(),
          is_active: true,
        });
      }

      showToast('Schedule saved! ✅');
      setShowGenerateModal(false);
    } catch {
      showToast('Failed to save schedule.', 'error');
    }
    setLoading(false);
  };

  const getTimeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return `${mins}m ago`;
  };

  const yoyTotal = getYoYChange(yearlyTotal, lastYearTotal);
  const yoyPending = getYoYChange(pendingBalances, lastYearPending);

  const filteredStatements = statementHistory.filter(s => {
    if (searchQuery && !s.period.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterFrom && s.id < filterFrom.substring(0, 7)) return false;
    if (filterTo && s.id > filterTo.substring(0, 7)) return false;
    return true;
  });

  const filteredActivity = recentActivity.filter(a => {
    if (searchQuery && !a.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const CATEGORIES = ['Rent', 'Water', 'Food', 'Internet', 'Electricity', 'Gas', 'Grocery'];

  return (
    <div className="reports-screen">

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.message}</div>
      )}

      {/* TopBar */}
      <TopBar
        profile={profile}
        setProfile={setProfile}
        household={household}
        currentUser={currentUser}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={markAllRead}
        title="HomeSync"
        showBell={true}
      />

      {/* Screen Title */}
      <div className="reports-title-section">
        <div className="reports-title-row">
          <div>
            <h2 className="reports-title">Reports & Analytics</h2>
            <p className="reports-subtitle">Top Spending & Balances</p>
          </div>
          <button
            className="export-icon-btn"
            onClick={() => setShowGenerateModal(true)}
          >
            <FileText size={20}/>
          </button>
        </div>

        {/* Household Switcher */}
        {allHouseholds.length > 1 && (
          <div className="household-switcher-wrap">
            <button
              className="household-switcher-pill"
              onClick={() => setShowHouseholdDropdown(!showHouseholdDropdown)}
            >
              🏠 {selectedHousehold?.name}
              <ChevronDown size={14}/>
            </button>
            {showHouseholdDropdown && (
              <div className="household-dropdown">
                <div className="household-search-wrap">
                  <Search size={13} className="household-search-icon"/>
                  <input
                    type="text"
                    placeholder="Search household..."
                    value={householdSearch}
                    onChange={e => setHouseholdSearch(e.target.value)}
                    className="household-search-input"
                  />
                </div>
                {allHouseholds
                  .filter(h => h.name.toLowerCase().includes(householdSearch.toLowerCase()))
                  .map(h => (
                    <button
                      key={h.id}
                      className={`household-option ${selectedHousehold?.id === h.id ? 'active' : ''}`}
                      onClick={() => handleSwitchHousehold(h)}
                    >
                      <span className="household-option-name">{h.name}</span>
                      <span className="household-option-role">{h.role}</span>
                    </button>
                  ))
                }
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scrollable Content */}
      <div className="reports-content">

        {/* Card 1 — Total Household Spent */}
        <div className="report-card">
          <p className="report-card-label">Total Household Spent (This Year)</p>
          <div className="report-card-row">
            <div>
              <p className="report-card-amount">
                ₱ {yearlyTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </p>
              {yoyTotal !== null && (
                <p className={`yoy-change ${Number(yoyTotal) > 0 ? 'up' : 'down'}`}>
                  {Number(yoyTotal) > 0 ? '↑' : '↓'} {Math.abs(yoyTotal)}% Year over year
                </p>
              )}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={monthlyData}>
              <XAxis
                dataKey="month"
                tick={{ fontSize: 9, fill: '#3B2AAB' }}
                axisLine={false}
                tickLine={false}
              />
              <Bar dataKey="amount" fill="#3B2AAB" radius={[4, 4, 0, 0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Card 2 — Largest Expense Category */}
        <div className="report-card">
          <p className="report-card-label">Largest Expense Category</p>
          {categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="35%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={55}
                  dataKey="value"
                >
                  {categoryData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]}/>
                  ))}
                </Pie>
                <Legend
                  layout="vertical"
                  align="right"
                  verticalAlign="middle"
                  iconSize={8}
                  iconType="circle"
                  formatter={(value) => (
                    <span style={{ fontSize: 11, color: '#3B2AAB' }}>{value}</span>
                  )}
                />
                <Tooltip
                  formatter={(value) => `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="no-data">No expense data yet</p>
          )}
        </div>

        {/* Card 3 — Pending Member Balances */}
        <div className="report-card">
          <p className="report-card-label">Pending Member Balances</p>
          <div className="report-card-row">
            <div>
              <p className="report-card-amount">
                ₱ {pendingBalances.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </p>
              {yoyPending !== null && (
                <p className={`yoy-change ${Number(yoyPending) > 0 ? 'up' : 'down'}`}>
                  {Number(yoyPending) > 0 ? '↑' : '↓'} {Math.abs(yoyPending)}% Year over year
                </p>
              )}
            </div>
          </div>
          {pendingByCategory.length > 0 && (
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={pendingByCategory}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 9, fill: '#3B2AAB' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {pendingByCategory.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]}/>
                  ))}
                </Bar>
                <Legend
                  iconSize={8}
                  formatter={(value) => (
                    <span style={{ fontSize: 9, color: '#3B2AAB' }}>{value}</span>
                  )}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Search & Filter */}
        <div className="search-filter-row">
          <div className="search-input-wrap">
            <Search size={14} className="search-icon"/>
            <input
              type="text"
              placeholder="Search reports..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
          <button className="filter-btn" onClick={() => setShowFilter(true)}>
            <Filter size={14}/> Filter
          </button>
        </div>

        {/* Statement History */}
        <div className="report-section">
          <p className="report-section-title">Statement History</p>
          <div className="statement-table">
            <div className="statement-header-row">
              <span>ID</span>
              <span>Period</span>
              <span>Total</span>
              <span>Date</span>
              <span>Status</span>
              <span></span>
            </div>
            {filteredStatements.length === 0 ? (
              <p className="no-data">No statements yet</p>
            ) : (
              filteredStatements.map((s, i) => (
                <div key={s.id} className="statement-row">
                  <span className="statement-id">ID {i + 501}</span>
                  <span className="statement-period">{s.period}</span>
                  <span className="statement-total">
                    ₱{s.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="statement-date">
                    {new Date(s.createdDate).toLocaleDateString()}
                  </span>
                  <span className="statement-status finalized">Finalized</span>
                  <div className="statement-actions">
                    <button
                      className="icon-btn-report"
                      onClick={() => { setSelectedStatement(s); setShowStatementDetail(true); }}
                    >
                      <Eye size={14}/>
                    </button>
                    <button
                      className="icon-btn-report"
                      onClick={() => handleExportPDF(s)}
                    >
                      <Download size={14}/>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Report Activity */}
        <div className="report-section">
          <p className="report-section-title">Recent Report Activity</p>
          {filteredActivity.length === 0 ? (
            <p className="no-data">No recent activity</p>
          ) : (
            filteredActivity.map(a => (
              <div key={a.id} className="activity-item">
                <div className="activity-avatar">
                  {a.profiles?.avatar_url ? (
                    <img src={a.profiles.avatar_url} alt="" className="activity-avatar-img"/>
                  ) : (
                    a.profiles?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="activity-info">
                  <p className="activity-desc">{a.description}</p>
                  <p className="activity-time">{getTimeAgo(a.created_at)}</p>
                </div>
              </div>
            ))
          )}
        </div>

      </div>

      {/* Generate & Export Modal */}
      {showGenerateModal && (
        <div className="modal-overlay-reports">
          <div className="generate-modal">
            <div className="modal-header">
              <h2>Generate & Export Report</h2>
              <button className="modal-close" onClick={() => setShowGenerateModal(false)}>
                <X size={18}/>
              </button>
            </div>

            <div className="modal-tabs">
              <button
                className={`modal-tab ${activeTab === 'generate' ? 'active' : ''}`}
                onClick={() => setActiveTab('generate')}
              >
                Generate New Report
              </button>
              <button
                className={`modal-tab ${activeTab === 'schedule' ? 'active' : ''}`}
                onClick={() => setActiveTab('schedule')}
              >
                Schedule Automated Reports
              </button>
            </div>

            <div className="modal-scroll">
              {activeTab === 'generate' ? (
                <>
                  <div className="form-group">
                    <label>Expense Range</label>
                    <input
                      type="date"
                      value={reportForm.expense_range}
                      onChange={e => setReportForm(prev => ({ ...prev, expense_range: e.target.value }))}
                    />
                  </div>

                  <div className="form-group">
                    <label>Category Filter</label>
                    <div className="select-wrap">
                      <select
                        value={reportForm.category_filter}
                        onChange={e => setReportForm(prev => ({
                          ...prev,
                          category_filter: Array.from(e.target.selectedOptions, o => o.value)
                        }))}
                        multiple
                        style={{ borderRadius: 16, height: 100 }}
                      >
                        {CATEGORIES.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <span style={{ fontSize: 10, color: '#9E8FCC', paddingLeft: 8 }}>
                      Hold Ctrl/Cmd to select multiple
                    </span>
                  </div>

                  <div className="form-group">
                    <label>Group Filter</label>
                    <div className="select-wrap">
                      <select
                        value={reportForm.group_filter}
                        onChange={e => setReportForm(prev => ({ ...prev, group_filter: e.target.value }))}
                      >
                        {allHouseholds.map(h => (
                          <option key={h.id} value={h.name}>{h.name}</option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="select-arrow"/>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Member Split Details</label>
                    <div className="select-wrap">
                      <select
                        value={reportForm.member_split}
                        onChange={e => setReportForm(prev => ({ ...prev, member_split: e.target.value }))}
                      >
                        <option value="total">Total</option>
                        <option value="detailed">Detailed by member</option>
                      </select>
                      <ChevronDown size={14} className="select-arrow"/>
                    </div>
                  </div>

                  <button
                    className="generate-btn"
                    onClick={handleGenerateReport}
                    disabled={loading}
                  >
                    {loading ? 'Generating...' : 'Generate Report'}
                  </button>

                  <button
                    className="export-pdf-btn"
                    onClick={() => handleExportPDF(null)}
                    disabled={loading}
                  >
                    <Download size={16}/> Export to PDF
                  </button>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>Frequency</label>
                    <div className="split-toggle">
                      {['monthly', 'weekly', 'custom'].map(f => (
                        <button
                          key={f}
                          className={`split-btn ${scheduleForm.frequency === f ? 'active' : ''}`}
                          onClick={() => setScheduleForm(prev => ({ ...prev, frequency: f }))}
                        >
                          {f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {scheduleForm.frequency === 'monthly' && (
                    <div className="form-group">
                      <label>Day of Month</label>
                      <input
                        type="number"
                        min="1"
                        max="28"
                        value={scheduleForm.day_of_month}
                        onChange={e => setScheduleForm(prev => ({ ...prev, day_of_month: Number(e.target.value) }))}
                      />
                    </div>
                  )}

                  {scheduleForm.frequency === 'custom' && (
                    <div className="form-group">
                      <label>Every X Days</label>
                      <input
                        type="number"
                        min="1"
                        value={scheduleForm.custom_interval_days}
                        onChange={e => setScheduleForm(prev => ({ ...prev, custom_interval_days: Number(e.target.value) }))}
                      />
                    </div>
                  )}

                  {reportSchedule && (
                    <div className="schedule-info">
                      <p>✅ Schedule active</p>
                      <p>Next report: {new Date(reportSchedule.next_scheduled_at).toLocaleDateString()}</p>
                    </div>
                  )}

                  <button
                    className="generate-btn"
                    onClick={handleSaveSchedule}
                    disabled={loading}
                  >
                    {loading ? 'Saving...' : 'Save Schedule'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Statement Detail Modal */}
      {showStatementDetail && selectedStatement && (
        <div className="modal-overlay-reports">
          <div className="generate-modal">
            <div className="modal-header">
              <h2>{selectedStatement.period} Statement</h2>
              <button className="modal-close" onClick={() => setShowStatementDetail(false)}>
                <X size={18}/>
              </button>
            </div>
            <div className="modal-scroll">
              <div className="statement-detail-summary">
                <div className="stat-detail-item">
                  <span className="stat-detail-label">Total</span>
                  <span className="stat-detail-value">
                    ₱{selectedStatement.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="stat-detail-item">
                  <span className="stat-detail-label">Expenses</span>
                  <span className="stat-detail-value">{selectedStatement.expenses.length}</span>
                </div>
              </div>

              {selectedStatement.expenses.map(e => (
                <div key={e.id} className="detail-expense-row">
                  <div className="detail-expense-info">
                    <p className="detail-expense-title">{e.title}</p>
                    <p className="detail-expense-meta">{e.category} | {e.expense_date}</p>
                  </div>
                  <div className="detail-expense-right">
                    <p className="detail-expense-amount">
                      ₱{Number(e.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </p>
                    <span
                      className="detail-expense-status"
                      style={{
                        color: e.status === 'paid' ? '#38a169' : '#856404',
                        background: e.status === 'paid' ? '#f0fff4' : '#fff3cd',
                      }}
                    >
                      {e.status}
                    </span>
                  </div>
                </div>
              ))}

              <button
                className="export-pdf-btn"
                onClick={() => handleExportPDF(selectedStatement)}
              >
                <Download size={16}/> Export to PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter Modal */}
      {showFilter && (
        <div className="modal-overlay-reports">
          <div className="filter-modal-reports">
            <div className="modal-header">
              <h2>Filter</h2>
              <button className="modal-close" onClick={() => setShowFilter(false)}>
                <X size={18}/>
              </button>
            </div>
            <div className="form-group">
              <label>Date From</label>
              <input
                type="date"
                value={filterFrom}
                onChange={e => setFilterFrom(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Date To</label>
              <input
                type="date"
                value={filterTo}
                onChange={e => setFilterTo(e.target.value)}
              />
            </div>
            <div className="filter-actions">
              <button
                className="filter-reset-btn"
                onClick={() => { setFilterFrom(''); setFilterTo(''); setShowFilter(false); }}
              >
                Reset
              </button>
              <button className="filter-apply-btn" onClick={() => setShowFilter(false)}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav active="reports"/>
    </div>
  );
}