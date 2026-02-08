import React, { useEffect, useState, useRef } from 'react';
import { supabase, checkSupabaseConfig } from './supabaseClient';
import { User, Message } from './types';
import { GlassCard, NeonButton, Input, Badge } from './components/Layout';
import { AdminDashboard } from './components/AdminDashboard';
import { Send, LogOut, ChevronLeft, Shield, Clock, AlertTriangle, Lock, Globe, Users, Check, Bell } from 'lucide-react';

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
  
  // Notification State
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  
  // Login State
  const [loginUsername, setLoginUsername] = useState('');
  const [isConfigured, setIsConfigured] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Ref to track active user inside the subscription callback without re-subscribing
  const activeUserRef = useRef<User | null>(null);
  const currentUserRef = useRef<User | null>(null);

  // --- Initial Config Check ---
  useEffect(() => {
    setIsConfigured(checkSupabaseConfig());
  }, []);

  // Update Refs when state changes
  useEffect(() => {
    activeUserRef.current = activeUser;
    currentUserRef.current = currentUser;

    // Clear unread count when opening a chat
    if (activeUser) {
      setUnreadCounts(prev => {
        if (!prev[activeUser.id]) return prev; // No change needed
        const newCounts = { ...prev };
        delete newCounts[activeUser.id];
        return newCounts;
      });
    }
  }, [activeUser, currentUser]);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        fetchUsers();
      })
      .subscribe();

    // Initial Fetch
    fetchUsers();

    // Heartbeat
    const heartbeat = setInterval(() => updatePresence(true), 30000);

    return () => {
      updatePresence(false);
      supabase.removeChannel(userSub);
      clearInterval(heartbeat);
    };
  }, [currentUser]);

  // --- Global Message Listener (Notifications + Chat) ---
  useEffect(() => {
    if (!currentUser || !supabase) return;

    // We use a SINGLE global subscription to handle both active chat updates AND background notifications
    const msgSub = supabase
      .channel('global_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const newMsg = payload.new as Message;
        const currentActive = activeUserRef.current;
        const me = currentUserRef.current;
        
        if (!me) return;

        // 1. Identify the conversation ID this message belongs to
        const isGroupMsg = newMsg.receiver_id === null;
        let conversationId = '';

        if (isGroupMsg) {
          conversationId = GROUP_CHAT_ID;
        } else {
          // Direct Message: If I sent it, convo is receiver. If I received it, convo is sender.
          conversationId = newMsg.sender_id === me.id ? newMsg.receiver_id! : newMsg.sender_id;
        }

        // 2. Check if this message is relevant to me at all
        const isForMe = newMsg.receiver_id === me.id;
        const isFromMe = newMsg.sender_id === me.id;
        const isGlobal = isGroupMsg;

        if (!isForMe && !isFromMe && !isGlobal) return; // Ignore messages between two other people

        // 3. Logic: Update Chat View OR Update Badge
        if (currentActive && currentActive.id === conversationId) {
          // We are currently viewing this chat -> Add to messages list
          setMessages(prev => [...prev, newMsg]);
          scrollToBottom();
        } else {
          // We are NOT viewing this chat -> Add notification (unless I sent it)
          if (!isFromMe) {
            setUnreadCounts(prev => ({
              ...prev,
              [conversationId]: (prev[conversationId] || 0) + 1
            }));
            
            // Optional: Play a sound here if desired
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(msgSub);
    };
  }, [currentUser]);

  // --- Fetch History when Active Chat Changes ---
  useEffect(() => {
    if (activeUser) {
      fetchMessages();
    }
  }, [activeUser]);

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
      query = query.is('receiver_id', null);
    } else {
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
      let { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('username', inputName)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

      // Security / Admin Logic
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
          setLoginError("ACCESS DENIED: Identity not recognized.");
          return;
        }
      }

      setCurrentUser(existingUser as User);
    } catch (err: any) {
      console.error("Login Error:", err);
      setLoginError(err.message || "Connection failed");
    }
  };

  const handleLogout = async () => {
    if (currentUser && supabase) {
      await supabase.from('users').update({ is_online: false }).eq('id', currentUser.id);
    }
    setCurrentUser(null);
    setActiveUser(null);
    setMessages([]);
    setUnreadCounts({});
    setLoginError(null);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !currentUser || !activeUser || !inputText.trim()) return;

    if (!currentUser.can_send) {
      alert("Messaging disabled by admin.");
      return;
    }

    const payload = {
      sender_id: currentUser.id,
      receiver_id: activeUser.id === GROUP_CHAT_ID ? null : activeUser.id,
      username: currentUser.username,
      message: inputText.trim()
    };

    const { error } = await supabase.from('messages').insert(payload);

    if (error) {
      console.error(error);
      alert("Failed to send message.");
    } else {
      setInputText('');
    }
  };

  const getInitials = (name: string) => name.substring(0, 2).toUpperCase();

  // --- Render ---

  if (!isConfigured) return <div className="p-10 text-red-500">Supabase Config Missing</div>;

  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-black">
        {/* Cyberpunk Login Background */}
        <div className="absolute inset-0 pointer-events-none">
           <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-neon-green/10 rounded-full blur-[100px] animate-pulse-slow"></div>
           <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-neon-purple/10 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '1s'}}></div>
           <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
        </div>
        
        <GlassCard className="max-w-sm w-full p-8 z-10 border-neon-green/30 shadow-[0_0_50px_rgba(0,255,65,0.1)]">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-mono font-bold text-white tracking-tight mb-1 animate-pulse">ATPUKUR BOYS</h1>
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
                className="bg-black/50 border-white/20 focus:border-neon-green"
              />
            </div>
            <NeonButton type="submit" className="w-full justify-center group relative overflow-hidden">
              <span className="relative z-10">INITIALIZE_SESSION</span>
              <div className="absolute inset-0 bg-neon-green/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
            </NeonButton>
          </form>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col md:flex-row bg-black relative overflow-hidden">
      {/* App Background */}
      <div className="absolute inset-0 pointer-events-none z-0">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-neon-blue/5 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-neon-green/5 rounded-full blur-[120px]"></div>
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] mix-blend-overlay"></div>
      </div>

      {showAdmin && <AdminDashboard onClose={() => setShowAdmin(false)} />}

      {/* Sidebar */}
      <div className={`
        ${showSidebarMobile ? 'flex' : 'hidden'} 
        md:flex flex-col w-full md:w-80 border-r border-white/10 bg-black/40 backdrop-blur-xl z-20 h-full
      `}>
        {/* User Profile Header */}
        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-900 to-black border border-white/20 flex items-center justify-center shadow-lg">
               <span className="font-mono font-bold text-white text-lg">{getInitials(currentUser.username)}</span>
            </div>
            <div>
              <div className="font-mono font-bold text-white text-sm">{currentUser.username}</div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-1.5 h-1.5 bg-neon-green rounded-full shadow-[0_0_5px_#00ff41] animate-pulse"></span>
                <span className="text-[9px] text-neon-green uppercase tracking-wider">Online</span>
              </div>
            </div>
          </div>
          <button onClick={handleLogout} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        {/* User List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-hide">
          
          {/* Global Channel */}
          <div className="mb-4">
             <div className="px-2 mb-2 flex items-center gap-2">
                <Globe className="w-3 h-3 text-gray-500" />
                <span className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">Global Uplink</span>
             </div>
             <div 
               onClick={() => { setActiveUser(GROUP_CHAT_USER); setShowSidebarMobile(false); }}
               className={`
                 relative group p-3 rounded-xl cursor-pointer transition-all duration-300 border overflow-hidden
                 ${activeUser?.id === GROUP_CHAT_ID 
                    ? 'bg-neon-purple/10 border-neon-purple/40 shadow-[0_0_15px_rgba(188,19,254,0.15)]' 
                    : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}
               `}
             >
               <div className="flex items-center gap-3 relative z-10">
                  <div className={`p-2 rounded-lg transition-colors ${activeUser?.id === GROUP_CHAT_ID ? 'bg-neon-purple text-black' : 'bg-black/40 text-gray-400'}`}>
                    <Users className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <div className={`font-mono text-sm font-bold truncate ${activeUser?.id === GROUP_CHAT_ID ? 'text-white' : 'text-gray-300'}`}>PUBLIC_NET</div>
                        {unreadCounts[GROUP_CHAT_ID] ? (
                          <div className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-pulse border border-red-400">
                            {unreadCounts[GROUP_CHAT_ID]}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-gray-500 truncate mt-0.5">Broadcast Channel</div>
                  </div>
               </div>
               {activeUser?.id === GROUP_CHAT_ID && <div className="absolute left-0 top-0 bottom-0 w-1 bg-neon-purple"></div>}
             </div>
          </div>

          <div className="px-2 mb-2 flex items-center gap-2">
            <Lock className="w-3 h-3 text-gray-500" />
            <span className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">Private Uplinks</span>
          </div>
          
          {users.filter(u => u.id !== currentUser.id).map(user => (
            <div 
              key={user.id}
              onClick={() => { setActiveUser(user); setShowSidebarMobile(false); }}
              className={`
                relative group p-3 rounded-xl cursor-pointer transition-all duration-300 border mb-2
                ${activeUser?.id === user.id 
                   ? 'bg-white/10 border-white/20' 
                   : 'bg-transparent border-transparent hover:bg-white/5'}
              `}
            >
              <div className="flex items-center gap-3 relative z-10">
                <div className="relative">
                  <div className="w-10 h-10 rounded-lg bg-black/60 border border-white/10 flex items-center justify-center text-gray-400 font-mono text-sm shadow-inner">
                    {getInitials(user.username)}
                  </div>
                  <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-black ${user.is_online ? 'bg-neon-green shadow-[0_0_5px_rgba(0,255,65,0.8)]' : 'bg-gray-600'}`} />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <div className="font-mono text-sm text-gray-200 group-hover:text-white transition-colors truncate">
                      {user.username}
                    </div>
                    {/* Unread Badge Logic */}
                    {unreadCounts[user.id] ? (
                      <div className="bg-red-500 text-white text-[10px] font-bold min-w-[20px] h-[20px] flex items-center justify-center rounded-full shadow-[0_0_8px_rgba(239,68,68,0.6)] animate-bounce border border-red-400">
                        {unreadCounts[user.id]}
                      </div>
                    ) : (
                      user.role === 'admin' && <span className="text-[8px] border border-neon-purple/40 text-neon-purple px-1 rounded">ADMIN</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                     <span className="text-[10px] text-gray-500 font-mono truncate">
                       {user.is_online ? 'ACTIVE NOW' : `SEEN: ${new Date(user.last_seen).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`}
                     </span>
                  </div>
                </div>
              </div>
              {activeUser?.id === user.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-white"></div>}
            </div>
          ))}
        </div>

        {/* Footer */}
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
                 ENCRYPTED v2.0
               </span>
             </div>
           )}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`
        ${!showSidebarMobile ? 'flex' : 'hidden'} 
        md:flex flex-1 flex-col z-10 h-full relative bg-gradient-to-b from-black via-[#050505] to-black
      `}>
        {activeUser ? (
          <>
            {/* Header */}
            <div className="h-16 border-b border-white/10 bg-glass-base backdrop-blur-md flex items-center px-4 justify-between sticky top-0 z-30 shadow-lg">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setShowSidebarMobile(true)}
                  className="md:hidden p-2 text-gray-400 hover:text-white"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shadow-lg ${activeUser.id === GROUP_CHAT_ID ? 'bg-neon-purple/20 text-neon-purple' : 'bg-white/10 text-white'}`}>
                      {activeUser.id === GROUP_CHAT_ID ? <Globe className="w-5 h-5" /> : <span className="font-mono font-bold">{getInitials(activeUser.username)}</span>}
                  </div>
                  <div>
                    <div className="font-mono font-bold text-white flex items-center gap-2 text-sm md:text-base">
                      {activeUser.username}
                      {activeUser.role === 'admin' && activeUser.id !== GROUP_CHAT_ID && <Badge status="admin" />}
                    </div>
                    <div className={`text-[10px] font-mono tracking-widest uppercase flex items-center gap-1.5 ${activeUser.id === GROUP_CHAT_ID ? 'text-neon-purple' : 'text-neon-blue'}`}>
                       {activeUser.is_online ? <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${activeUser.id === GROUP_CHAT_ID ? 'bg-neon-purple' : 'bg-neon-blue'}`}></span> : <Clock className="w-3 h-3"/>}
                       {activeUser.id === GROUP_CHAT_ID ? 'BROADCAST FREQUENCY' : (activeUser.is_online ? 'SECURE CONNECTION' : 'OFFLINE')}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 scroll-smooth bg-black/40">
               {messages.length === 0 && (
                 <div className="h-full flex flex-col items-center justify-center opacity-30 select-none">
                    <div className="w-24 h-24 border border-dashed border-white/20 rounded-full animate-[spin_10s_linear_infinite] mb-6 flex items-center justify-center">
                        <div className="w-16 h-16 border border-dotted border-white/30 rounded-full animate-[spin_5s_linear_infinite_reverse]"></div>
                    </div>
                    <p className="font-mono text-sm tracking-[0.2em] text-white">CHANNEL INITIALIZED</p>
                    <p className="font-mono text-[10px] text-gray-500 mt-2">NO DATA PACKETS EXCHANGED</p>
                 </div>
               )}
               
               {messages.map((msg, idx) => {
                 const isMe = msg.sender_id === currentUser.id;
                 const showHeader = idx === 0 || messages[idx-1].sender_id !== msg.sender_id || (new Date(msg.created_at).getTime() - new Date(messages[idx-1].created_at).getTime() > 300000);
                 const isGroup = activeUser.id === GROUP_CHAT_ID;

                 return (
                   <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-in slide-in-from-bottom-2 duration-300 fade-in`}>
                     
                     <div className={`flex items-end gap-3 max-w-[85%] md:max-w-[70%] ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                        
                        {/* Avatar */}
                        {!isMe && (
                          <div className="w-8 h-8 rounded-lg bg-black/60 border border-white/10 flex-shrink-0 flex items-center justify-center text-[10px] font-mono font-bold text-gray-400 mb-1 shadow-lg">
                             {getInitials(msg.username)}
                          </div>
                        )}

                        <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                           {/* Sender Name in Group */}
                           {isGroup && !isMe && showHeader && (
                             <span className="text-[10px] font-mono font-bold text-neon-purple mb-1 ml-1">{msg.username}</span>
                           )}

                           {/* The Bubble */}
                           <div className={`
                             relative px-5 py-3 text-sm leading-relaxed shadow-lg
                             ${isMe 
                               ? 'bg-neon-green/5 text-neon-green border border-neon-green/30 rounded-2xl rounded-tr-sm shadow-[0_0_15px_rgba(0,255,65,0.05)]' 
                               : 'bg-[#121212] text-gray-200 border border-white/10 rounded-2xl rounded-tl-sm backdrop-blur-sm'}
                           `}>
                             {msg.message}
                             
                             {/* Timestamp */}
                             <div className={`text-[9px] font-mono mt-2 flex items-center gap-1 opacity-50 ${isMe ? 'justify-end text-neon-green' : 'text-gray-500'}`}>
                                {new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                {isMe && <Check className="w-3 h-3" />}
                             </div>
                           </div>
                        </div>
                     </div>
                   </div>
                 );
               })}
               <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 md:p-6 border-t border-white/10 bg-black/80 backdrop-blur-xl z-20">
              <form onSubmit={sendMessage} className="flex gap-4 relative max-w-4xl mx-auto w-full">
                 <div className="relative flex-1 group">
                    <div className={`absolute -inset-0.5 rounded-lg blur opacity-20 transition duration-500 group-hover:opacity-40 ${activeUser.id === GROUP_CHAT_ID ? 'bg-neon-purple' : 'bg-neon-green'}`}></div>
                    <Input 
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder={currentUser.can_send ? (activeUser.id === GROUP_CHAT_ID ? "Broadcast to public net..." : "Encrypted message...") : "ACCESS RESTRICTED"}
                        disabled={!currentUser.can_send}
                        className="bg-black relative pr-12 text-sm"
                    />
                 </div>
                 <button 
                   type="submit" 
                   disabled={!inputText.trim() || !currentUser.can_send}
                   className={`
                      p-3 rounded-lg flex items-center justify-center transition-all duration-300
                      ${!inputText.trim() ? 'bg-white/5 text-gray-600' : (activeUser.id === GROUP_CHAT_ID ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/50 shadow-[0_0_15px_rgba(188,19,254,0.3)] hover:bg-neon-purple hover:text-white' : 'bg-neon-green/20 text-neon-green border border-neon-green/50 shadow-[0_0_15px_rgba(0,255,65,0.3)] hover:bg-neon-green hover:text-black')}
                   `}
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