// app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import { AuthListener } from '../components/AuthListener';

export const metadata: Metadata = {
  title: 'ISE Work Tracker',
  description: 'Internal tasks & timeline',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* ใส่ app-body ไว้ด้วย เผื่อยังมี style ผูกกับคลาสนี้ */}
      <body className="app-body">
        {/* ตัวนี้จะคอยฟัง event จาก Supabase ตลอดอายุแอป */}
        <AuthListener />
        {children}
      </body>
    </html>
  );
}
