import OlaIntelligenceDashboard from '@/components/OlaIntelligenceDashboard';
import './ola-intelligence.css';
import './monthly-intelligence.css';
export const dynamic='force-dynamic';
export default function OlaHome(){
  return <div className="page account-page-shell"><OlaIntelligenceDashboard/></div>;
}
