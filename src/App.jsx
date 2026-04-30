import { BrowserRouter, Routes, Route } from 'react-router-dom';
import SplashScreen from './screens/SplashScreen';
import RegisterScreen from './screens/RegisterScreen';
import LoginScreen from './screens/LoginScreen';
import DashboardScreen from './screens/DashboardScreen';
import ExpensesScreen from './screens/ExpensesScreen';
import UtilitiesScreen from './screens/UtilitiesScreen';
import GroupsScreen from './screens/GroupsScreen';
import GroupDetailScreen from './screens/GroupDetailScreen';
import ReportsScreen from './screens/ReportsScreen';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SplashScreen />} />
        <Route path="/register" element={<RegisterScreen />} />
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/dashboard" element={<DashboardScreen />} />
        <Route path="/expenses" element={<ExpensesScreen />} />
        <Route path="/utilities" element={<UtilitiesScreen />} />
        <Route path="/groups" element={<GroupsScreen />} />
        <Route path="/group-detail/:id" element={<GroupDetailScreen />} />
        <Route path="/reports" element={<ReportsScreen />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;