import React, { useEffect, useState, useRef } from 'react';
import { supabase, checkSupabaseConfig } from './supabaseClient';
import { User, Message } from './types';
import { GlassCard, NeonButton, Input, Badge } from './components/Layout';
import { AdminDashboard } from './components/AdminDashboard';
import { Send, Menu, LogOut, ChevronLeft, Shield, Clock, AlertTriangle, Lock, Globe, Users } from 'lucide-react';

// Constant for the Group Chat "User" placeholder
const GROUP_CHAT_ID = 'global_public_channel';
const GROUP_CHAT_USER: User = {
  id: GROUP_CHAT_ID,
  username: 'PUBLIC_NET',
  role: 'user', 
  can_send: true, 
  is_online: true, 
  last_seen: new Date().toISOString(),
  created_at: new Date().toISOString()
};

export default function App() {
  // State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeUser, setActiveUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);
  const [showSidebarMobile, setShowSidebarMobile] = useState(true);
  
  // Login State
  const [loginUsername, setLoginUsername] = useState('');
  const [isConfigured, setIsConfigured] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // --- Initial Config Check ---
  useEffect(() => {
    setIsConfigured(checkSupabaseConfig());
  }, []);

  // --- Presence & User List Logic ---
  useEffect(() => {
    if (!currentUser || !supabase) return;

    // Set online status
    const updatePresence = async (status: boolean) => {
      await supabase.from('users').update({ 
        is_online: status,
        last_seen: new Date().toISOString()
      }).eq('id', currentUser.id);
    };

    updatePresence(true);

    // Subscribe to User changes
    const userSub = supabase
      .channel('public:users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload) => {
        // Optimistically update user list
        fetchUsers();
      })
      .subscribe();

    // Initial Fetch
    fetchUsers();

    // Heartbeat for last_seen
    const heartbeat = setInterval(() => updatePresence(true), 30000);

    // Cleanup
    return () => {
      updatePresence(false);
      supabase.removeChannel(userSub);
      clearInterval(heartbeat);
    };
  }, [currentUser]);

  // --- Message Subscription ---
  useEffect(() => {
    if (!currentUser || !activeUser || !supabase) return;

    // Fetch conversation history
    fetchMessages();

    // Determine filter for subscription
    const isGroup = activeUser.id === GROUP_CHAT_ID;
    const channelName = isGroup ? 'chat:global' : `chat:${currentUser.id}-${activeUser.id}`;

    // Realtime subscription
    const msgSub = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const newMsg = payload.new as Message;
        
        // Logic to decide if this message belongs in the current view
        let shouldAdd = false;

        if (isGroup) {
          // In group chat, accept messages where receiver_id is NULL or undefined
          // Using strict equality (=== null) can fail if payload omits null fields
          if (!newMsg.receiver_id) {
            shouldAdd = true;
          }
        } else {
          // In DM, accept messages between me and activeUser
          const isRelated = 
            (newMsg.sender_id === currentUser.id && newMsg.receiver_id === activeUser.id) ||
            (newMsg.sender_id === activeUser.id && newMsg.receiver_id === currentUser.id);
          if (isRelated) shouldAdd = true;
        }
        
        if (shouldAdd) {
          setMessages(prev => [...prev, newMsg]);
          scrollToBottom();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(msgSub);
    };
  }, [currentUser, activeUser]);

  // --- Actions ---

  const fetchUsers = async () => {
    if (!supabase) return;
    const { data } = await supabase.from('users').select('*').order('is_online', { ascending: false });
    if (data) setUsers(data as User[]);
  };

  const fetchMessages = async () => {
    if (!supabase || !currentUser || !activeUser) return;
    
    let query = supabase.from('messages').select('*');

    if (activeUser.id === GROUP_CHAT_ID) {
      // Fetch messages where receiver_id is NULL (Group Chat)
      query = query.is('receiver_id', null);
    } else {
      // Fetch DM messages
      query = query.or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${activeUser.id}),and(sender_id.eq.${activeUser.id},receiver_id.eq.${currentUser.id})`);
    }

    const { data } = await query.order('created_at', { ascending: true });
    
    if (data) {
      setMessages(data as Message[]);
      scrollToBottom();
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!supabase) return;
    
    const inputName = loginUsername.trim();
    if (!inputName) return;

    try {
      // Check if user exists
      let { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('username', inputName)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }

      // --- SECURITY LOGIC ---
      if (inputName === 'habib') {
        if (!existingUser) {
           const { data: adminUser, error: createError } = await supabase
            .from('users')
            .insert({
              username: 'habib',
              role: 'admin',
              can_send: true,
              is_online: true,
              last_seen: new Date().toISOString()
            })
            .select()
            .single();
            if (createError) throw createError;
            existingUser = adminUser;
        } else if (existingUser.role !== 'admin') {
            await supabase.from('users').update({ role: 'admin' }).eq('id', existingUser.id);
            existingUser.role = 'admin';
        }
      } else {
        if (!existingUser) {
          setLoginError("ACCESS DENIED: Identity not recognized. Contact Admin 'habib' for clearance.");
          return;
        }
      }

      setCurrentUser(existingUser as User);
    } catch (err: any) {
      console.error("Login Error:", err);
      if (err.code === '42P01' || err.message?.includes('relation "public.users" does not exist')) {
        setLoginError("DATABASE ERROR: Tables not found. Please run the SQL script.");
      } else {
        setLoginError(`Connection Error: ${err.message}`);
      }
    }
  };

  const handleLogout = async () => {
    if (currentUser && supabase) {
      await supabase.from('users').update({ is_online: false }).eq('id', currentUser.id);
    }
    setCurrentUser(null);
    setActiveUser(null);
    setMessages([]);
    setLoginError(null);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !currentUser || !activeUser || !inputText.trim()) return;

    if (!currentUser.can_send) {
      alert("Messaging disabled by admin.");
      return;
    }

    // Prepare payload
    const payload = {
      sender_id: currentUser.id,
      receiver_id: activeUser.id === GROUP_CHAT_ID ? null : activeUser.id, // Null represents group chat
      username: currentUser.username,
      message: inputText.trim()
    };

    const { error } = await supabase.from('messages').insert(payload);

    if (error) {
      console.error(error);
      alert("Failed to send message. Check console.");
    } else {
      setInputText('');
    }
  };

  // --- Views ---

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
         <GlassCard className="max-w-md w-full p-8 text-center border-red-500/50">
            <h1 className="text-2xl font-mono font-bold text-red-500 mb-4">SYSTEM_ERROR</h1>
            <p className="text-gray-400 mb-4">Supabase connection not found.</p>
         </GlassCard>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
           <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-neon-green/10 rounded-full blur-[100px] animate-pulse-slow"></div>
           <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-neon-purple/10 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '1s'}}></div>
        </div>
        
        <GlassCard className="max-w-sm w-full p-8 z-10">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-mono font-bold text-white tracking-tight mb-1">ATPUKUR BOYS</h1>
            <p className="text-neon-green text-xs font-mono tracking-[0.3em] uppercase opacity-70">Secure Uplink v2.0</p>
          </div>
          
          {loginError && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-red-200 font-mono text-left">{loginError}</div>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="text-xs font-mono text-gray-500 mb-2 block ml-1">OPERATIVE_ID</label>
              <Input 
                autoFocus
                placeholder="Enter Alias..." 
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
              />
            </div>
            <NeonButton type="submit" className="w-full">
              INITIALIZE_SESSION
            </NeonButton>
            <p className="text-[10px] text-gray-600 text-center font-mono">
              UNAUTHORIZED ACCESS IS STRICTLY PROHIBITED
            </p>
          </form>
        </GlassCard>
      </div>
    );
  }

  // --- Main App ---
  return (
    <div className="h-screen flex flex-col md:flex-row bg-black relative">
      {/* Background Ambience */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-neon-blue/5 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-neon-green/5 rounded-full blur-[120px]"></div>
      </div>

      {/* Admin Modal */}
      {showAdmin && <AdminDashboard onClose={() => setShowAdmin(false)} />}

      {/* Sidebar - Users */}
      <div className={`
        ${showSidebarMobile ? 'flex' : 'hidden'} 
        md:flex flex-col w-full md:w-80 border-r border-white/10 bg-black/40 backdrop-blur-xl z-20 h-full
      `}>
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
          <div>
            <div className="font-mono font-bold text-white">{currentUser.username}</div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="w-1.5 h-1.5 bg-neon-green rounded-full shadow-[0_0_5px_#00ff41]"></span>
              <span className="text-[10px] text-neon-green uppercase tracking-wider">Online</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={handleLogout}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Channels & User List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          
          {/* Global Channel Item */}
          <div className="mb-4">
             <div className="px-3 py-2 text-[10px] text-gray-500 font-mono uppercase tracking-widest">Global Uplink</div>
             <div 
               onClick={() => {
                 setActiveUser(GROUP_CHAT_USER);
                 setShowSidebarMobile(false);
               }}
               className={`
                 group p-3 rounded-lg cursor-pointer transition-all duration-200 border border-transparent flex items-center gap-3
                 ${activeUser?.id === GROUP_CHAT_ID ? 'bg-neon-purple/20 border-neon-purple/50 shadow-[0_0_10px_rgba(188,19,254,0.2)]' : 'hover:bg-white/5'}
               `}
             >
               <div className={`p-2 rounded-lg ${activeUser?.id === GROUP_CHAT_ID ? 'bg-neon-purple text-black' : 'bg-white/10 text-gray-300'}`}>
                 <Globe className="w-5 h-5" />
               </div>
               <div>
                  <div className={`font-mono text-sm font-bold ${activeUser?.id === GROUP_CHAT_ID ? 'text-white' : 'text-gray-300'}`}>PUBLIC_NET</div>
                  <div className="text-[10px] text-gray-500">Broadcast Channel</div>
               </div>
             </div>
          </div>

          <div className="px-3 py-2 text-[10px] text-gray-500 font-mono uppercase tracking-widest">Private Uplinks</div>
          
          {users.filter(u => u.id !== currentUser.id).map(user => (
            <div 
              key={user.id}
              onClick={() => {
                setActiveUser(user);
                setShowSidebarMobile(false);
              }}
              className={`
                group p-3 rounded-lg cursor-pointer transition-all duration-200 border border-transparent
                ${activeUser?.id === user.id ? 'bg-white/10 border-white/10' : 'hover:bg-white/5'}
              `}
            >
              <div className="flex justify-between items-start">
                <div className="font-mono text-sm text-gray-200 group-hover:text-white transition-colors">
                  {user.username}
                </div>
                <div className={`w-2 h-2 rounded-full mt-1.5 ${user.is_online ? 'bg-neon-green shadow-[0_0_8px_rgba(0,255,65,0.5)]' : 'bg-gray-600'}`} />
              </div>
              <div className="flex items-center gap-1 mt-1">
                 <span className="text-[10px] text-gray-500 font-mono">
                   {user.is_online ? 'ACTIVE_NOW' : `SEEN: ${new Date(user.last_seen).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`}
                 </span>
                 {user.role === 'admin' && <span className="text-[8px] border border-neon-purple/40 text-neon-purple px-1 rounded ml-auto">ADMIN</span>}
              </div>
            </div>
          ))}
          {users.length <= 1 && (
            <div className="p-4 text-center text-xs text-gray-600 font-mono">
              NO PRIVATE TARGETS
            </div>
          )}
        </div>

        {/* Footer: Admin vs User View */}
        <div className="p-4 border-t border-white/10 bg-black/20">
           {currentUser.role === 'admin' ? (
             <NeonButton 
               variant="primary" 
               className="w-full flex items-center justify-center gap-2"
               onClick={() => setShowAdmin(true)}
             >
               <Shield className="w-4 h-4" />
               ADMIN_PANEL
             </NeonButton>
           ) : (
             <div className="w-full p-2 rounded border border-white/5 bg-white/5 flex items-center justify-center gap-2">
               <Lock className="w-3 h-3 text-gray-500" />
               <span className="text-[10px] font-mono text-gray-500 tracking-widest uppercase">
                 ACCESS LEVEL: OPERATIVE
               </span>
             </div>
           )}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`
        ${!showSidebarMobile ? 'flex' : 'hidden'} 
        md:flex flex-1 flex-col z-10 h-full relative
      `}>
        {activeUser ? (
          <>
            {/* Chat Header */}
            <div className="h-16 border-b border-white/10 bg-glass-base backdrop-blur-md flex items-center px-4 justify-between sticky top-0 z-30">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setShowSidebarMobile(true)}
                  className="md:hidden p-2 text-gray-400 hover:text-white"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <div>
                  <div className="font-mono font-bold text-white flex items-center gap-2">
                    {activeUser.id === GROUP_CHAT_ID && <Globe className="w-4 h-4 text-neon-purple" />}
                    {activeUser.username}
                    {activeUser.role === 'admin' && activeUser.id !== GROUP_CHAT_ID && <Badge status="admin" />}
                  </div>
                  <div className={`text-[10px] font-mono tracking-widest uppercase flex items-center gap-1 ${activeUser.id === GROUP_CHAT_ID ? 'text-neon-purple' : 'text-neon-blue'}`}>
                     {activeUser.is_online ? <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${activeUser.id === GROUP_CHAT_ID ? 'bg-neon-purple' : 'bg-neon-blue'}`}></span> : <Clock className="w-3 h-3"/>}
                     {activeUser.id === GROUP_CHAT_ID ? 'Global Broadcast Active' : (activeUser.is_online ? 'Secure Connection Established' : 'Offline')}
                  </div>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
               {messages.length === 0 && (
                 <div className="h-full flex flex-col items-center justify-center opacity-30">
                    <div className="w-24 h-24 border border-dashed border-white rounded-full animate-spin-slow mb-4"></div>
                    <p className="font-mono text-xs tracking-widest">ENCRYPTED CHANNEL READY</p>
                 </div>
               )}
               
               {messages.map((msg, idx) => {
                 const isMe = msg.sender_id === currentUser.id;
                 const showHeader = idx === 0 || messages[idx-1].sender_id !== msg.sender_id;
                 const isGroup = activeUser.id === GROUP_CHAT_ID;

                 return (
                   <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                     {showHeader && (
                       <div className="flex items-center gap-2 mb-1 px-1">
                          <span className={`text-[10px] font-mono font-bold ${isMe ? 'text-neon-green' : (isGroup ? 'text-neon-purple' : 'text-gray-400')}`}>
                            {isMe ? 'YOU' : msg.username}
                          </span>
                          <span className="text-[8px] text-gray-600 font-mono">
                            {new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </span>
                       </div>
                     )}
                     <div className={`
                       max-w-[80%] md:max-w-[60%] px-4 py-3 rounded-2xl text-sm leading-relaxed backdrop-blur-sm
                       ${isMe 
                         ? 'bg-neon-green/10 text-neon-green border border-neon-green/20 rounded-tr-none shadow-[0_0_10px_rgba(0,255,65,0.05)]' 
                         : (isGroup ? 'bg-neon-purple/10 text-gray-200 border border-neon-purple/20 rounded-tl-none' : 'bg-white/5 text-gray-200 border border-white/10 rounded-tl-none')}
                     `}>
                       {msg.message}
                     </div>
                   </div>
                 );
               })}
               <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t border-white/10 bg-black/40 backdrop-blur-xl">
              <form onSubmit={sendMessage} className="flex gap-3 relative">
                 <Input 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={currentUser.can_send ? (activeUser.id === GROUP_CHAT_ID ? "Broadcast to everyone..." : "Type encrypted message...") : "Messaging disabled by admin"}
                    disabled={!currentUser.can_send}
                    className={`pr-12 ${activeUser.id === GROUP_CHAT_ID ? 'focus:border-neon-purple/70 focus:ring-neon-purple/50' : ''}`}
                 />
                 <button 
                   type="submit" 
                   disabled={!inputText.trim() || !currentUser.can_send}
                   className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${activeUser.id === GROUP_CHAT_ID ? 'text-neon-purple hover:text-white' : 'text-neon-green hover:text-white'}`}
                 >
                   <Send className="w-5 h-5" />
                 </button>
              </form>
            </div>
          </>
        ) : (
          /* Empty State */
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 bg-black/20">
             <div className="w-32 h-32 border border-white/5 rounded-full flex items-center justify-center mb-6 relative">
                <div className="absolute inset-0 bg-neon-blue/5 blur-xl rounded-full animate-pulse-slow"></div>
                <div className="w-24 h-24 border-t border-l border-neon-blue/30 rounded-full animate-spin"></div>
             </div>
             <h2 className="text-xl font-mono text-white mb-2 tracking-widest">SYSTEM IDLE</h2>
             <p className="text-xs font-mono text-gray-600">SELECT A TARGET TO COMMENCE UPLINK</p>
          </div>
        )}
      </div>
    </div>
  );
}