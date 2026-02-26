import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { User } from '../types';
import { X, Save, User as UserIcon, Image as ImageIcon } from 'lucide-react';
import { NeonButton, Input } from './Layout';

interface UserProfileDashboardProps {
  user: User;
  onClose: () => void;
  onUpdate: (updatedUser: User) => void;
}

export function UserProfileDashboard({ user, onClose, onUpdate }: UserProfileDashboardProps) {
  const [username, setUsername] = useState(user.username);
  const [fullName, setFullName] = useState(user.full_name || '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const { data, error: updateError } = await supabase
        .from('users')
        .update({
          username,
          full_name: fullName,
          avatar_url: avatarUrl
        })
        .eq('id', user.id)
        .select()
        .single();

      if (updateError) throw updateError;
      
      if (data) {
        onUpdate(data as User);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err: any) {
      console.error('Error updating profile:', err);
      setError(err.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-black/90 border border-white/10 rounded-xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
          <div className="flex items-center gap-2 text-white font-mono">
            <UserIcon className="w-5 h-5 text-neon-green" />
            <span>USER_PROFILE</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {error && (
            <div className="mb-4 p-3 bg-red-900/20 border border-red-500/50 rounded text-xs text-red-400 font-mono">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-green-900/20 border border-green-500/50 rounded text-xs text-green-400 font-mono">
              PROFILE UPDATED SUCCESSFULLY
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">Alias (Username)</label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter unique alias"
                required
                className="font-mono text-sm"
              />
            </div>
            
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">Full Name</label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter full name"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">Avatar URL</label>
              <div className="relative">
                <ImageIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://..."
                  className="pl-9 font-mono text-sm"
                />
              </div>
            </div>

            <div className="pt-4">
              <NeonButton 
                type="submit" 
                variant="primary" 
                className="w-full flex items-center justify-center gap-2"
                disabled={loading}
              >
                <Save className="w-4 h-4" />
                {loading ? 'SAVING...' : 'SAVE CHANGES'}
              </NeonButton>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
