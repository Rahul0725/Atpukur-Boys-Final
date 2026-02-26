export interface User {
  id: string;
  username: string;
  full_name?: string;
  avatar_url?: string;
  role: 'admin' | 'user';
  can_send: boolean;
  is_online: boolean;
  last_seen: string;
  created_at: string;
}

export interface Message {
  id: string;
  created_at: string;
  sender_id: string;
  receiver_id: string | null;
  username: string;
  message: string;
}

export interface SupabaseConfig {
  url: string;
  key: string;
}