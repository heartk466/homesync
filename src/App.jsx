import { BrowserRouter, Routes, Route } from 'react-router-dom';
import SplashScreen from './screens/SplashScreen';
import RegisterScreen from './screens/RegisterScreen';
import LoginScreen from './screens/LoginScreen';
import DashboardScreen from './screens/DashboardScreen';
import ExpensesScreen from './screens/ExpensesScreen';
import UtilitiesScreen from './screens/UtilitiesScreen';

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
      </Routes>
    </BrowserRouter>
  );
}

export default App;