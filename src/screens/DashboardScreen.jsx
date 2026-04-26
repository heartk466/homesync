import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  BarChart, Bar, XAxis, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import {
  Home, FileText, Users, Zap, BarChart2, Settings,
  Copy, Share2, X, LogOut, Camera, Edit
} from 'lucide-react';
import './DashboardScreen.css';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';

const COLORS = ['#3B2AAB', '#AE96FF', '#D4C5FF'];

export default function DashboardScreen() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [profile, setProfile] = useState(null);
  const [household, setHousehold] = useState(null);
  const [totalSpent, setTotalSpent] = useState(0);
  const [lastMonthSpent, setLastMonthSpent] = useState(0);
  const [yourShare, setYourShare] = useState(0);
  const [monthlyData, setMonthlyData] = useState([]);
  const [categoryData, setCategoryData] = useState([]);
  const [pendingAmount, setPendingAmount] = useState(0);
  const [showProfile, setShowProfile] = useState(false);
  const [showHouseholdCode, setShowHouseholdCode] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeNav, setActiveNav] = useState('dashboard');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editForm, setEditForm] = useState({ full_name: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return '☀️ Good Morning';
    if (hour >= 12 && hour < 17) return '👋 Good Afternoon';
    return '🌙 Good Evening';
  };

  const getFirstName = () => {
    if (!profile?.full_name) return '';
    return profile.full_name.split(' ')[0];
  };

  const getInitials = () => {
    if (!profile?.full_name) return 'U';
    return profile.full_name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const getPercentChange = () => {
    if (lastMonthSpent === 0) return null;
    const change = ((totalSpent - lastMonthSpent) / lastMonthSpent) * 100;
    return change.toFixed(1);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(household?.code || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    const shareData = {
      title: 'Join my HomeSync Household!',
      text: `Join my household "${household?.name}" on HomeSync! Use code: ${household?.code}`,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        handleCopyCode();
      }
    } else {
      handleCopyCode();
      alert('Code copied! Share it with your household members.');
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const handlePhotoClick = () => {
    fileInputRef.current.click();
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert('Please select a JPG, PNG or WebP image.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be less than 2MB.');
      return;
    }

    setUploadingPhoto(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${currentUser.id}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) {
        alert('Failed to upload photo. Try again.');
        setUploadingPhoto(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      const publicUrl = urlData.publicUrl;

      await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', currentUser.id);

      setAvatarUrl(publicUrl);
      setProfile(prev => ({ ...prev, avatar_url: publicUrl }));

    } catch {
      alert('Something went wrong. Try again.');
    }

    setUploadingPhoto(false);
  };

  const handleEditProfile = () => {
    setEditForm({ full_name: profile?.full_name || '' });
    setEditSuccess(false);
    setShowProfile(false);
    setShowEditModal(true);
  };

  const handleSaveProfile = async () => {
    if (!editForm.full_name.trim()) {
      alert('Full name cannot be empty.');
      return;
    }

    setEditLoading(true);

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: editForm.full_name.trim() })
      .eq('id', currentUser.id);

    if (error) {
      alert('Failed to update profile. Try again.');
    } else {
      setProfile(prev => ({ ...prev, full_name: editForm.full_name.trim() }));
      setEditSuccess(true);
      setTimeout(() => {
        setShowEditModal(false);
        setEditSuccess(false);
      }, 1500);
    }

    setEditLoading(false);
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

      if (profileData?.avatar_url) {
        setAvatarUrl(profileData.avatar_url);
      }

      if (profileData?.household_id) {
        const { data: householdData } = await supabase
          .from('households')
          .select('*')
          .eq('id', profileData.household_id)
          .single();
        setHousehold(householdData);
      }

      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString().split('T')[0];
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        .toISOString().split('T')[0];

      const { data: expenses } = await supabase
        .from('expenses')
        .select('*')
        .eq('household_id', profileData?.household_id)
        .gte('expense_date', firstDay)
        .lte('expense_date', lastDay);

      if (expenses) {
        const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
        setTotalSpent(total);

        const myExpenses = expenses.filter(e => e.paid_by === user.id);
        const myTotal = myExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
        setYourShare(myTotal);

        const pending = expenses
          .filter(e => e.status === 'pending' && e.paid_by === user.id)
          .reduce((sum, e) => sum + Number(e.amount), 0);
        setPendingAmount(pending);

        const categories = {};
        expenses.forEach(e => {
          categories[e.category] = (categories[e.category] || 0) + Number(e.amount);
        });
        setCategoryData(
          Object.entries(categories).map(([name, value]) => ({ name, value }))
        );
      }

      const months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const first = new Date(d.getFullYear(), d.getMonth(), 1)
          .toISOString().split('T')[0];
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
          .toISOString().split('T')[0];

        const { data: monthExpenses } = await supabase
          .from('expenses')
          .select('amount')
          .eq('household_id', profileData?.household_id)
          .gte('expense_date', first)
          .lte('expense_date', last);

        const monthTotal = (monthExpenses || [])
          .reduce((sum, e) => sum + Number(e.amount), 0);

        months.push({
          month: d.toLocaleString('default', { month: 'short' })[0],
          amount: monthTotal,
        });
      }
      setMonthlyData(months);

      const lastMonthFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        .toISOString().split('T')[0];
      const lastMonthLast = new Date(now.getFullYear(), now.getMonth(), 0)
        .toISOString().split('T')[0];

      const { data: lastMonthExpenses } = await supabase
        .from('expenses')
        .select('amount')
        .eq('household_id', profileData?.household_id)
        .gte('expense_date', lastMonthFirst)
        .lte('expense_date', lastMonthLast);

      const lastTotal = (lastMonthExpenses || [])
        .reduce((sum, e) => sum + Number(e.amount), 0);
      setLastMonthSpent(lastTotal);

    } catch (err) {
      console.error(err);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home, path: '/dashboard' },
    { id: 'expenses', label: 'Expenses', icon: FileText, path: '/expenses' },
    { id: 'groups', label: 'Groups', icon: Users, path: '/groups' },
    { id: 'utilities', label: 'Utilities', icon: Zap, path: '/utilities' },
    { id: 'reports', label: 'Reports', icon: BarChart2, path: '/reports' },
    { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
  ];

  const percentChange = getPercentChange();

  return (
    <div className="dashboard">

      <TopBar
  profile={profile}
  setProfile={setProfile}
  household={household}
  currentUser={currentUser}
  notifications={[]}
  unreadCount={0}
  title="Dashboard"
  showBell={false}
/>

      {/* Scrollable Content */}
      <div className="dash-content">

        {/* Card 1 — Total Spent */}
        <div className="dash-card">
          <div className="card-left">
            <p className="card-greeting">{getGreeting()}, {getFirstName()}!</p>
            <p className="card-label">Total Spent</p>
            <p className="card-amount">
              ₱ {totalSpent.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </p>
            <p className="card-sub">this month</p>
            {percentChange !== null && (
              <p className={`card-change ${Number(percentChange) > 0 ? 'up' : 'down'}`}>
                {Number(percentChange) > 0 ? '↑' : '↓'} {Math.abs(percentChange)}% vs last month
              </p>
            )}
          </div>
          <div className="card-chart">
            <ResponsiveContainer width={120} height={80}>
              <BarChart data={monthlyData}>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: '#3B2AAB' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Bar dataKey="amount" fill="#3B2AAB" radius={[4, 4, 0, 0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Card 2 — Your Share */}
        <div className="dash-card">
          <div className="card-left">
            <p className="card-label">Your Share</p>
            <p className="card-amount">
              ₱ {yourShare.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </p>
            <p className="card-sub">this month</p>
            {pendingAmount > 0 && (
              <span className="pending-badge">
                Pending: ₱{pendingAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
          <div className="card-chart">
            {categoryData.length > 0 ? (
              <ResponsiveContainer width={130} height={100}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx={50}
                    cy={45}
                    innerRadius={28}
                    outerRadius={42}
                    dataKey="value"
                  >
                    {categoryData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]}/>
                    ))}
                  </Pie>
                  <Legend
                    iconSize={8}
                    iconType="circle"
                    formatter={(value) => (
                      <span style={{ fontSize: 10, color: '#3B2AAB' }}>{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="no-data">No data yet</p>
            )}
          </div>
        </div>

        {/* Card 3 — Quick Actions */}
        <div className="dash-card quick-actions">
          <p className="quick-title">Quick Actions</p>
          <button className="quick-btn" onClick={() => navigate('/expenses')}>
            Add Expense
          </button>
          <button className="quick-btn" onClick={() => navigate('/groups')}>
            Create Group
          </button>
          <button className="quick-btn" onClick={() => navigate('/reports')}>
            View Reports
          </button>
        </div>

      </div>

      {/* Floating Household Code */}
      <div className="floating-code-wrap">
        {showHouseholdCode && (
          <div className="household-code-card">
            <p className="code-household-name">{household?.name}</p>
            <p className="code-value">{household?.code}</p>
            <div className="code-actions">
              <button className="code-copy-btn" onClick={handleCopyCode}>
                <Copy size={14}/> {copied ? 'Copied!' : 'Copy'}
              </button>
              <button className="code-share-btn" onClick={handleShare}>
                <Share2 size={14}/> Share
              </button>
            </div>
          </div>
        )}
        <button
          className="floating-code-btn"
          onClick={() => setShowHouseholdCode(!showHouseholdCode)}
        >
          🏠 Your Code
        </button>
      </div>

      {/* Bottom Navigation */}
      <div className="bottom-nav">
        {navItems.map(item => (
          <button
            key={item.id}
            className={`nav-item ${activeNav === item.id ? 'active' : ''}`}
            onClick={() => { setActiveNav(item.id); navigate(item.path); }}
          >
            <item.icon size={20}/>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

    </div>
  );
}