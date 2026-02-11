import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { User, Message } from '../types';
import { GlassCard, NeonButton, Input, Badge } from './Layout';
import { X, RefreshCw, Trash2, Shield, UserX, MessageSquare, Activity, Settings, Lock, AlertTriangle } from 'lucide-react';

interface AdminDashboardProps {
  onClose: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'users' | 'messages' | 'stats' | 'system'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [newUser, setNewUser] = useState('');

  const fetchData = async () => {
    if (!supabase) return;
    setLoading(true);
    
    // Fetch users
    const { data: usersData } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (usersData) setUsers(usersData as User[]);

    // Fetch messages
    const { data: msgData } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false });

    if (msgData) setMessages(msgData as Message[]);
    
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleToggleSend = async (userId: string, currentStatus: boolean) => {
    if (!supabase) return;
    await supabase.from('users').update({ can_send: !currentStatus }).eq('id', userId);
    fetchData();
  };

  const handleToggleRole = async (userId: string, currentRole: string) => {
    if (!supabase) return;
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    await supabase.from('users').update({ role: newRole }).eq('id', userId);
    fetchData();
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!supabase) return;
    if (confirm('Delete this message permanently?')) {
      await supabase.from('messages').delete().eq('id', msgId);
      fetchData();
    }
  };

  const handleLockdown = async (enable: boolean) => {
    if (!supabase) return;
    const action = enable ? "LOCKDOWN" : "UNLOCK";
    if (confirm(`WARNING: INITIATE GLOBAL ${action}? ${enable ? 'This will silence all operatives except admins.' : 'This will restore communication.'}`)) {
        setLoading(true);
        // Only update non-admin users
        await supabase.from('users').update({ can_send: !enable }).neq('role', 'admin');
        await fetchData();
        setLoading(false);
    }
  };

  const handlePurge = async () => {
    if (!supabase) return;
    if (confirm("CRITICAL WARNING: PURGE ALL DATA LOGS? This action is irreversible and will delete ALL chat history.")) {
        setLoading(true);
        // Delete all rows where ID is not null (effectively all)
        await supabase.from('messages').delete().neq('username', 'PLACEHOLDER_IMPOSSIBLE_NAME'); 
        await fetchData();
        setLoading(false);
    }
  };

  const handleCreateUser = async () => {
    if (!supabase || !newUser.trim()) return;
    const { error } = await supabase.from('users').insert({
      username: newUser.trim(),
      role: 'user',
      can_send: true,
      is_online: false
    });

    if (!error) {
      setNewUser('');
      fetchData();
    } else {
      alert('Error creating user (might duplicate username)');
    }
  };

  const onlineCount = users.filter(u => u.is_online).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-0 md:p-4">
      <GlassCard className="w-full max-w-6xl h-[100dvh] md:h-[90vh] rounded-none md:rounded-xl animate-in fade-in zoom-in duration-300 border-neon-green/20">
        
        <div className="flex flex-col h-full w-full">
            {/* Header */}
            <div className="p-4 md:p-6 border-b border-white/10 flex justify-between items-center bg-black/20 shrink-0">
              <div className="flex items-center gap-2 md:gap-3">
                <Shield className="text-neon-green w-5 h-5 md:w-6 md:h-6" />
                <h2 className="text-lg md:text-xl font-mono font-bold tracking-wider text-white">
                  ADMIN_<span className="text-neon-green">CONSOLE</span>
                </h2>
              </div>
              <NeonButton variant="ghost" onClick={onClose} className="p-1 md:p-2">
                <X className="w-5 h-5 md:w-6 md:h-6" />
              </NeonButton>
            </div>

            {/* Layout Container */}
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
              
              {/* Sidebar Nav (Desktop) / Top Tabs (Mobile) */}
              <div className="w-full md:w-64 bg-black/20 border-b md:border-b-0 md:border-r border-white/10 p-2 md:p-4 flex flex-row md:flex-col gap-2 overflow-x-auto shrink-0 no-scrollbar">
                {[
                  { id: 'users', icon: UserX, label: 'USERS', mobileLabel: 'USERS' },
                  { id: 'messages', icon: MessageSquare, label: 'MESSAGES', mobileLabel: 'MSGS' },
                  { id: 'stats', icon: Activity, label: 'LIVE_STATS', mobileLabel: 'STATS' },
                  { id: 'system', icon: Settings, label: 'SYSTEM', mobileLabel: 'SYS' },
                ].map((tab) => (
                  <button 
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`
                      p-2 md:p-3 rounded-lg text-left font-mono text-xs md:text-sm flex items-center justify-center md:justify-start gap-2 md:gap-3 transition-colors flex-1 md:flex-none whitespace-nowrap min-w-[80px]
                      ${activeTab === tab.id ? 'bg-neon-green/20 text-neon-green border border-neon-green/30' : 'text-gray-400 hover:text-white hover:bg-white/5'}
                    `}
                  >
                    <tab.icon className="w-4 h-4" /> 
                    <span className="hidden md:inline">{tab.label}</span>
                    <span className="inline md:hidden">{tab.mobileLabel}</span>
                  </button>
                ))}
              </div>

              {/* Content Area */}
              <div className="flex-1 p-4 md:p-6 overflow-y-auto bg-black/10 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {loading && <div className="text-neon-green font-mono animate-pulse mb-4 text-sm">Fetching data packets...</div>}
                
                {!loading && activeTab === 'users' && (
                  <div className="space-y-6">
                     {/* Create User */}
                     <div className="flex flex-col md:flex-row gap-3 items-end max-w-md">
                        <div className="w-full md:flex-1">
                          <label className="text-xs text-gray-500 font-mono mb-1 block">NEW_OPERATIVE_HANDLE</label>
                          <Input 
                            placeholder="Enter username..." 
                            value={newUser}
                            onChange={(e) => setNewUser(e.target.value)}
                            className="w-full"
                          />
                        </div>
                        <NeonButton onClick={handleCreateUser} className="w-full md:w-auto">INIT_USER</NeonButton>
                     </div>

                     <div className="grid gap-4">
                        {users.map(user => (
                          <div key={user.id} className="bg-white/5 p-4 rounded-lg border border-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                            <div className="w-full md:w-auto">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-white font-mono break-all">{user.username}</span>
                                {user.role === 'admin' && <Badge status="admin" />}
                                <Badge status={user.is_online ? 'online' : 'offline'} />
                              </div>
                              <div className="text-[10px] text-gray-500 mt-1 font-mono break-all">ID: {user.id}</div>
                            </div>
                            <div className="flex gap-2 w-full md:w-auto">
                              <NeonButton 
                                variant="ghost" 
                                className={`flex-1 md:flex-none text-xs justify-center ${user.can_send ? 'text-green-400' : 'text-red-400'}`}
                                onClick={() => handleToggleSend(user.id, user.can_send)}
                              >
                                {user.can_send ? 'SEND: YES' : 'SEND: NO'}
                              </NeonButton>
                              <NeonButton 
                                variant="ghost" 
                                className="flex-1 md:flex-none text-xs justify-center"
                                onClick={() => handleToggleRole(user.id, user.role)}
                              >
                                {user.role === 'admin' ? 'DEMOTE' : 'PROMOTE'}
                              </NeonButton>
                            </div>
                          </div>
                        ))}
                     </div>
                  </div>
                )}

                {!loading && activeTab === 'messages' && (
                  <div className="space-y-4">
                     <div className="flex justify-between items-center mb-4">
                       <h3 className="font-mono text-neon-blue text-sm md:text-lg">INTERCEPTED_COMMUNICATIONS</h3>
                       <NeonButton variant="ghost" onClick={fetchData}><RefreshCw className="w-4 h-4" /></NeonButton>
                     </div>
                     {messages.map(msg => (
                       <div key={msg.id} className="bg-white/5 p-3 md:p-4 rounded-lg border border-white/10 flex flex-col md:flex-row justify-between items-start gap-3 hover:bg-white/10 transition-colors">
                         <div className="w-full overflow-hidden">
                           <div className="flex items-center gap-2 mb-1 flex-wrap">
                             <span className="text-neon-green font-mono text-sm font-bold">{msg.username}</span>
                             <span className="text-[10px] text-gray-500">{new Date(msg.created_at).toLocaleString()}</span>
                             {!msg.receiver_id && <span className="text-[9px] bg-neon-purple/20 text-neon-purple px-1.5 py-0.5 rounded border border-neon-purple/30">GLOBAL</span>}
                           </div>
                           <p className="text-gray-300 text-sm break-words leading-relaxed">{msg.message}</p>
                         </div>
                         <button 
                            onClick={() => handleDeleteMessage(msg.id)}
                            className="text-red-500 hover:text-red-400 p-2 self-end md:self-start bg-white/5 rounded-md md:bg-transparent"
                         >
                           <Trash2 className="w-4 h-4" />
                         </button>
                       </div>
                     ))}
                  </div>
                )}

                {!loading && activeTab === 'stats' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                    <GlassCard className="p-4 md:p-6 flex flex-col items-center justify-center border-neon-green/30">
                      <span className="text-3xl md:text-4xl font-mono font-bold text-white mb-2">{onlineCount}</span>
                      <span className="text-neon-green text-xs md:text-sm font-mono tracking-widest uppercase">Operatives Online</span>
                    </GlassCard>
                    <GlassCard className="p-4 md:p-6 flex flex-col items-center justify-center border-neon-blue/30">
                      <span className="text-3xl md:text-4xl font-mono font-bold text-white mb-2">{users.length}</span>
                      <span className="text-neon-blue text-xs md:text-sm font-mono tracking-widest uppercase">Total Database</span>
                    </GlassCard>
                    <GlassCard className="p-4 md:p-6 flex flex-col items-center justify-center border-neon-purple/30">
                      <span className="text-3xl md:text-4xl font-mono font-bold text-white mb-2">{messages.length}</span>
                      <span className="text-neon-purple text-xs md:text-sm font-mono tracking-widest uppercase">Total Transmissions</span>
                    </GlassCard>
                  </div>
                )}

                {!loading && activeTab === 'system' && (
                  <div className="space-y-6">
                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex gap-4 items-start">
                      <AlertTriangle className="w-8 h-8 text-red-500 flex-shrink-0" />
                      <div>
                        <h3 className="text-red-500 font-mono font-bold mb-1">DANGER ZONE</h3>
                        <p className="text-gray-400 text-sm">These controls affect the entire system infrastructure. Proceed with caution.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                      <GlassCard className="p-4 md:p-6 border-orange-500/30">
                        <h3 className="font-mono text-orange-400 font-bold mb-4 flex items-center gap-2">
                          <Lock className="w-5 h-5" /> GLOBAL LOCKDOWN
                        </h3>
                        <p className="text-xs md:text-sm text-gray-400 mb-6">
                          Instantly disable messaging for all non-admin users. Admins can still communicate.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3">
                          <NeonButton onClick={() => handleLockdown(true)} variant="danger" className="justify-center">
                            INITIATE
                          </NeonButton>
                          <NeonButton onClick={() => handleLockdown(false)} variant="primary" className="justify-center">
                            LIFT LOCKDOWN
                          </NeonButton>
                        </div>
                      </GlassCard>

                      <GlassCard className="p-4 md:p-6 border-red-500/30">
                        <h3 className="font-mono text-red-500 font-bold mb-4 flex items-center gap-2">
                          <Trash2 className="w-5 h-5" /> DATA PURGE
                        </h3>
                        <p className="text-xs md:text-sm text-gray-400 mb-6">
                          Permanently delete all intercepted communications from the database. This cannot be undone.
                        </p>
                        <NeonButton onClick={handlePurge} variant="danger" className="w-full justify-center">
                          EXECUTE PURGE PROTOCOL
                        </NeonButton>
                      </GlassCard>
                    </div>
                  </div>
                )}
              </div>
            </div>
        </div>
      </GlassCard>
    </div>
  );
};