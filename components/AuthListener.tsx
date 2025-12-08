// components/AuthListener.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../utils/supabase';

export function AuthListener() {
  const router = useRouter();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth event:', event, session);

      // เคส: คลิกลิงก์ Reset password จากอีเมล
      if (event === 'PASSWORD_RECOVERY') {
        // ส่งไปหน้า /account ที่มีฟอร์มเปลี่ยนรหัสผ่าน
        router.push('/account');
      }

      // เผื่ออนาคต:
      // if (event === 'SIGNED_IN') { ... }
      // if (event === 'SIGNED_OUT') { ... }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  // ไม่ต้อง render UI อะไรเลย
  return null;
}
