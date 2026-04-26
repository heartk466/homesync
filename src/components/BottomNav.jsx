import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, FileText, Users, Zap, BarChart2, Settings } from 'lucide-react';
import './BottomNav.css';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: Home, path: '/dashboard' },
  { id: 'expenses', label: 'Expenses', icon: FileText, path: '/expenses' },
  { id: 'groups', label: 'Groups', icon: Users, path: '/groups' },
  { id: 'utilities', label: 'Utilities', icon: Zap, path: '/utilities' },
  { id: 'reports', label: 'Reports', icon: BarChart2, path: '/reports' },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
];

export default function BottomNav({ active, pendingCount = 0 }) {
  const navigate = useNavigate();

  return (
    <div className="bottom-nav">
      {navItems.map(item => (
        <button
          key={item.id}
          className={`nav-item ${active === item.id ? 'active' : ''}`}
          onClick={() => navigate(item.path)}
        >
          <div className="nav-icon-wrap">
            <item.icon size={22}/>
            {item.id === 'expenses' && pendingCount > 0 && (
              <span className="nav-badge">{pendingCount}</span>
            )}
          </div>
          <span className="nav-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}