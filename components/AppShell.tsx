'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Database, LayoutDashboard, ShoppingBag, Store, Upload, Utensils } from 'lucide-react';

const olaNav = [
  { href: '/daraz', label: 'Daraz', icon: ShoppingBag },
  { href: '/pandamart', label: 'Pandamart', icon: Store },
  { href: '/shajgoj', label: 'Shajgoj', icon: ShoppingBag },
  { href: '/foodi', label: 'Foodi', icon: Utensils },
  { href: '/othoba', label: 'Othoba', icon: ShoppingBag },
];

const utilityNav = [
  { href: '/uploads', label: 'Uploads', icon: Upload },
  { href: '/master', label: 'Master Data', icon: Database },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const olaActive = olaNav.some(({ href }) => pathname.startsWith(href));
  const [olaOpen, setOlaOpen] = useState(olaActive);

  useEffect(() => {
    if (olaActive) setOlaOpen(true);
  }, [olaActive]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">U</div>
          <div>
            <strong>Unilever Stock Intelligence System</strong>
          </div>
        </div>
        <nav className="nav-list">
          <Link href="/" className={`nav-item ${pathname === '/' ? 'active' : ''}`}>
            <LayoutDashboard size={18} strokeWidth={1.8} />
            <span>Central Availability</span>
          </Link>

          <div className={`nav-group ${olaOpen ? 'open' : ''} ${olaActive ? 'active' : ''}`}>
            <button type="button" className="nav-group-toggle" onClick={() => setOlaOpen((open) => !open)} aria-expanded={olaOpen}>
              <ShoppingBag size={18} strokeWidth={1.8} />
              <span>OLA</span>
              <ChevronDown className="nav-chevron" size={16} strokeWidth={1.8} />
            </button>
            {olaOpen && (
              <div className="nav-sublist">
                {olaNav.map(({ href, label, icon: Icon }) => {
                  const active = pathname.startsWith(href);
                  return (
                    <Link key={href} href={href} className={`nav-subitem ${active ? 'active' : ''}`}>
                      <Icon size={15} strokeWidth={1.8} />
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {utilityNav.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={`nav-item ${active ? 'active' : ''}`}>
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
