import React, { useEffect, useState, useRef } from 'react';
import { supabase, checkSupabaseConfig } from './supabaseClient';
import { User, Message } from './types';
import { GlassCard, NeonButton, Input, Badge, UserAvatar, getAvatarEmoji } from './components/Layout';
import { AdminDashboard } from './components/AdminDashboard';
import { UserProfileDashboard } from './components/UserProfileDashboard';
import { Send, LogOut, ChevronLeft, Shield, Clock, AlertTriangle, Lock, Globe, Users, Check, Bell, Phone, PhoneOff, Mic, MicOff, PhoneIncoming, Terminal, Cpu, User as UserIcon } from 'lucide-react';

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

// WebRTC Configuration
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

type CallStatus = 'idle' | 'calling' | 'incoming' | 'connected';

export default function App() {
  // State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeUser, setActiveUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSidebarMobile, setShowSidebarMobile] = useState(true);
  
  // Realtime Presence State
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  // Notification State
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  
  // Voice & Video Chat State
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [incomingCallUser, setIncomingCallUser] = useState<User | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  // Login State
  const [loginUsername, setLoginUsername] = useState('');
  const [isConfigured, setIsConfigured] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeUserRef = useRef<User | null>(null);
  const currentUserRef = useRef<User | null>(null);
  
  // WebRTC Refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const callTimerRef = useRef<any>(null);
  const callStatusRef = useRef<CallStatus>('idle');

  // --- Initial Config & Session Restore ---
  useEffect(() => {
    setIsConfigured(checkSupabaseConfig());
    
    // Attempt to restore session from Supabase Auth
    const restoreSession = async () => {
      if (supabase) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            const { data, error } = await supabase.from('users').select('*').eq('id', session.user.id).single();
            if (data && !error) {
              setCurrentUser(data as User);
              await supabase.from('users').update({ is_online: true }).eq('id', session.user.id);
            } else if (error && error.code === 'PGRST116') {
              // User in auth but not in public.users yet (trigger might be delayed)
              // We'll wait for the trigger or insert manually if needed
              // For now, let's just retry after a short delay
              setTimeout(async () => {
                const { data: retryData } = await supabase.from('users').select('*').eq('id', session.user.id).single();
                if (retryData) {
                  setCurrentUser(retryData as User);
                  await supabase.from('users').update({ is_online: true }).eq('id', session.user.id);
                }
              }, 1000);
            }
          }
        } catch (e) {
          console.error("Session restore failed", e);
        }
      }
      setIsRestoringSession(false);
    };
    
    restoreSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const { data } = await supabase.from('users').select('*').eq('id', session.user.id).single();
        if (data) {
          setCurrentUser(data as User);
          await supabase.from('users').update({ is_online: true }).eq('id', session.user.id);
        } else {
           setTimeout(async () => {
              const { data: retryData } = await supabase.from('users').select('*').eq('id', session.user.id).single();
              if (retryData) {
                setCurrentUser(retryData as User);
                await supabase.from('users').update({ is_online: true }).eq('id', session.user.id);
              }
            }, 1000);
        }
      } else if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
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

  // Sync state to ref for Event Listeners
  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  // Attach remote stream to video element whenever hasRemoteVideo changes
  useEffect(() => {
    if (hasRemoteVideo && remoteVideoRef.current && remoteStreamRef.current) {
        console.log("Attaching video stream to element", remoteStreamRef.current.getTracks());
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
        remoteVideoRef.current.play().catch(e => console.error("Error playing video:", e));
    }
  }, [hasRemoteVideo, remoteStreamRef.current]);

  // --- Presence & User List Logic ---
  useEffect(() => {
    if (!currentUser || !supabase) return;

    // 1. Database Persistence (for Last Seen & History)
    // We still update the DB, but less frequently, just to keep "last_seen" roughly accurate.
    const updateDbPresence = async (status: boolean) => {
      // Guard against null currentUser inside async closure
      if (!currentUserRef.current) return;
      
      await supabase.from('users').update({ 
        is_online: status,
        last_seen: new Date().toISOString()
      }).eq('id', currentUserRef.current.id);
    };

    updateDbPresence(true);
    // Relaxed heartbeat for DB (1 min)
    const heartbeat = setInterval(() => updateDbPresence(true), 60000);

    // 2. Realtime Presence (Socket-based, Instant)
    const presenceChannel = supabase.channel('room_presence', {
      config: {
        presence: {
          key: currentUser.id, // Use User ID as the presence key
        },
      },
    });

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const newState = presenceChannel.presenceState();
        const ids = new Set<string>();
        // Since we set key to currentUser.id, the keys of the state object are the user IDs
        Object.keys(newState).forEach(key => ids.add(key));
        setOnlineUserIds(ids);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            online_at: new Date().toISOString(),
          });
        }
      });

    // 3. User Data Subscription (New users, role changes, etc)
    const userSub = supabase
      .channel('public:users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload) => {
        if (payload.eventType === 'DELETE' && payload.old && payload.old.id === currentUser.id) {
            alert("CRITICAL ERROR: IDENTITY PURGED FROM SERVER.");
            handleLogout();
        } else {
            fetchUsers();
        }
      })
      .subscribe();

    // Initial Fetch
    fetchUsers();

    // Handle Unload
    const handleUnload = () => {
       updateDbPresence(false);
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      updateDbPresence(false);
      clearInterval(heartbeat);
      window.removeEventListener('beforeunload', handleUnload);
      supabase.removeChannel(userSub);
      supabase.removeChannel(presenceChannel);
    };
  }, [currentUser]);

  // --- Global Message Listener (Notifications + Chat) ---
  useEffect(() => {
    if (!currentUser || !supabase) return;

    const msgSub = supabase
      .channel('global_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const newMsg = payload.new as Message;
        const currentActive = activeUserRef.current;
        const me = currentUserRef.current;
        
        if (!me) return;

        const isGroupMsg = newMsg.receiver_id === null;
        let conversationId = '';

        if (isGroupMsg) {
          conversationId = GROUP_CHAT_ID;
        } else {
          conversationId = newMsg.sender_id === me.id ? newMsg.receiver_id! : newMsg.sender_id;
        }

        const isForMe = newMsg.receiver_id === me.id;
        const isFromMe = newMsg.sender_id === me.id;
        const isGlobal = isGroupMsg;

        if (!isForMe && !isFromMe && !isGlobal) return;

        if (currentActive && currentActive.id === conversationId) {
          setMessages(prev => [...prev, newMsg]);
          scrollToBottom();
        } else {
          if (!isFromMe) {
            setUnreadCounts(prev => ({
              ...prev,
              [conversationId]: (prev[conversationId] || 0) + 1
            }));
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(msgSub);
    };
  }, [currentUser]);

  // --- Signaling Listener (Voice + Screen) ---
  useEffect(() => {
    if (!currentUser || !supabase) return;

    const signalingSub = supabase.channel('public:signaling')
      .on('broadcast', { event: 'signal' }, async ({ payload }) => {
        // Guard against race conditions where currentUser might be null in closure
        if (!payload || !currentUser || payload.targetId !== currentUser.id) return;
        
        const currentStatus = callStatusRef.current;
        // Check if this is a renegotiation (we are connected and have a PC)
        const isRenegotiation = currentStatus === 'connected' && !!peerConnectionRef.current;

        // Handle Offer
        if (payload.type === 'offer') {
          if (currentStatus !== 'idle' && !isRenegotiation && currentStatus !== 'incoming') {
            // Already in a call with someone else
            return;
          }

          if (isRenegotiation) {
             console.log("Received Renegotiation Offer");
             const pc = peerConnectionRef.current;
             if (!pc) return;

             // Handle glare or state mismatch
             if (pc.signalingState !== "stable") {
                 console.log("Rollback signaling state");
                 await Promise.all([
                     pc.setLocalDescription({type: "rollback"}),
                     pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
                 ]);
             } else {
                 await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
             }
             
             const answer = await pc.createAnswer();
             await pc.setLocalDescription(answer);
             
             await supabase?.channel('public:signaling').send({
                type: 'broadcast',
                event: 'signal',
                payload: {
                    type: 'answer',
                    targetId: payload.caller.id,
                    sdp: answer
                }
             });
             return;
          }

          // New Call
          const caller = payload.caller;
          setIncomingCallUser(caller);
          setCallStatus('incoming');
          
          const pc = createPeerConnection(caller.id);
          peerConnectionRef.current = pc;
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }

        // Handle Answer
        if (payload.type === 'answer') {
           const pc = peerConnectionRef.current;
           if (pc) {
             console.log("Received Answer");
             // We can accept answer even if not "stable" if we are the offerer
             await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
             
             if (currentStatus !== 'connected') {
                setCallStatus('connected');
                startCallTimer();
             }
           }
        }

        // Handle ICE Candidate
        if (payload.type === 'ice-candidate') {
          if (peerConnectionRef.current) {
            try {
              await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } catch (e) {
              console.error("Error adding ice candidate", e);
            }
          }
        }

        // Handle Hangup
        if (payload.type === 'hangup') {
          cleanupCall();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(signalingSub);
    };
  }, [currentUser]);

  // --- WebRTC Functions ---

  const createPeerConnection = (targetUserId: string) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        supabase?.channel('public:signaling').send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            type: 'ice-candidate',
            targetId: targetUserId,
            candidate: event.candidate
          }
        });
      }
    };

    pc.ontrack = (event) => {
      console.log("Track received:", event.track.kind, event.streams);
      
      let stream = event.streams[0];
      if (!stream) {
          stream = new MediaStream();
          stream.addTrack(event.track);
      }
      
      remoteStreamRef.current = stream;

      if (event.track.kind === 'video') {
         console.log("Video track detected via ontrack");
         setHasRemoteVideo(true);
         
         if (remoteVideoRef.current) {
             remoteVideoRef.current.srcObject = stream;
             remoteVideoRef.current.play().catch(console.error);
         }

         event.track.onended = () => {
             console.log("Video track ended");
             setHasRemoteVideo(false);
         };
      } else if (event.track.kind === 'audio') {
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = stream;
            remoteAudioRef.current.play().catch(e => console.error("Error playing audio:", e));
          }
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    return pc;
  };

  const startCall = async () => {
    if (!activeUser || !currentUser) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      
      const pc = createPeerConnection(activeUser.id);
      peerConnectionRef.current = pc;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await supabase?.channel('public:signaling').send({
        type: 'broadcast',
        event: 'signal',
        payload: {
          type: 'offer',
          targetId: activeUser.id,
          caller: currentUser,
          sdp: offer
        }
      });

      setCallStatus('calling');
    } catch (err) {
      console.error("Error starting call:", err);
      alert("Could not access microphone.");
    }
  };

  const answerCall = async () => {
    if (!incomingCallUser || !currentUser || !peerConnectionRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      stream.getTracks().forEach(track => {
        if (peerConnectionRef.current) {
          peerConnectionRef.current.addTrack(track, stream);
        }
      });

      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);

      await supabase?.channel('public:signaling').send({
        type: 'broadcast',
        event: 'signal',
        payload: {
          type: 'answer',
          targetId: incomingCallUser.id,
          sdp: answer
        }
      });

      setCallStatus('connected');
      startCallTimer();
    } catch (err) {
      console.error("Error answering call:", err);
      cleanupCall();
    }
  };

  const stopScreenShare = async () => {
    if (!peerConnectionRef.current || !isScreenSharing) return;
    
    console.log("Stopping screen share");
    const pc = peerConnectionRef.current;
    
    const senders = pc.getSenders();
    const videoSender = senders.find(s => s.track?.kind === 'video');
    
    if (videoSender) {
        pc.removeTrack(videoSender);
    }

    if (localStreamRef.current) {
        const videoTracks = localStreamRef.current.getVideoTracks();
        videoTracks.forEach(t => {
            t.stop();
            localStreamRef.current?.removeTrack(t);
        });
    }

    setIsScreenSharing(false);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      const targetId = activeUser?.id || incomingCallUser?.id;
      if (targetId) {
          await supabase?.channel('public:signaling').send({
            type: 'broadcast',
            event: 'signal',
            payload: {
              type: 'offer',
              targetId: targetId,
              caller: currentUser,
              sdp: offer
            }
          });
      }
    } catch(e) {
        console.error("Error stopping screen share:", e);
    }
  };

  const endCall = () => {
    const targetId = activeUser?.id || incomingCallUser?.id;
    if (targetId) {
       supabase?.channel('public:signaling').send({
        type: 'broadcast',
        event: 'signal',
        payload: {
          type: 'hangup',
          targetId: targetId
        }
      });
    }
    cleanupCall();
  };

  const cleanupCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    setCallStatus('idle');
    setIncomingCallUser(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsScreenSharing(false);
    setHasRemoteVideo(false);
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const startCallTimer = () => {
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    setCallDuration(0);
    callTimerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // --- Fetch History ---
  useEffect(() => {
    if (activeUser) fetchMessages();
  }, [activeUser]);

  const fetchUsers = async () => {
    if (!supabase) return;
    const { data } = await supabase.from('users').select('*').order('created_at', { ascending: false });
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
      let { data: existingUser, error: fetchError } = await supabase.from('users').select('*').eq('username', inputName).single();
      if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

      if (inputName === 'habib') {
        if (!existingUser) {
           const { data: adminUser, error: createError } = await supabase.from('users').insert({ username: 'habib', role: 'admin', can_send: true, is_online: true, last_seen: new Date().toISOString() }).select().single();
           if (createError) throw createError;
           existingUser = adminUser;
        } else if (existingUser.role !== 'admin') {
            await supabase.from('users').update({ role: 'admin' }).eq('id', existingUser.id);
            existingUser.role = 'admin';
        }
      } else {
        if (!existingUser) {
          setLoginError("ACCESS DENIED: IDENTITY UNKNOWN");
          return;
        }
      }
      
      // Save session
      localStorage.setItem('atpukur_user_id', existingUser.id);
      setCurrentUser(existingUser as User);
    } catch (err: any) {
      console.error("Login Error:", err);
      setLoginError(err.message || "UPLINK FAILED");
    }
  };

  const handleLogout = async () => {
    if (currentUser && supabase) await supabase.from('users').update({ is_online: false }).eq('id', currentUser.id);
    await supabase.auth.signOut();
    setCurrentUser(null);
    setActiveUser(null);
    setUsers([]); // Clear users to prevent stale data crash
    setMessages([]);
    setUnreadCounts({});
    setLoginError(null);
    setOnlineUserIds(new Set());
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !currentUser || !activeUser || !inputText.trim()) return;
    if (!currentUser.can_send) { alert("Messaging disabled by admin."); return; }

    const payload = {
      sender_id: currentUser.id,
      receiver_id: activeUser.id === GROUP_CHAT_ID ? null : activeUser.id,
      username: currentUser.username,
      message: inputText.trim()
    };
    const { error } = await supabase.from('messages').insert(payload);
    if (error) { console.error(error); alert("Failed to send message."); } else { setInputText(''); }
  };

  // --- Helpers for Display ---
  // Sort users so connected (green dot) users are always first
  // SAFEGUARD: Check currentUser exists before filtering
  const sortedUsers = currentUser ? [...users.filter(u => u.id !== currentUser.id)].sort((a, b) => {
    const aOnline = onlineUserIds.has(a.id);
    const bOnline = onlineUserIds.has(b.id);
    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;
    return 0;
  }) : [];

  const getIsUserOnline = (userId: string) => onlineUserIds.has(userId);

  // --- Render ---

  if (!isConfigured) return <div className="p-10 text-red-500">Supabase Config Missing</div>;
  
  if (isRestoringSession) {
      return (
        <div className="h-[100dvh] bg-black flex flex-col items-center justify-center">
            <div className="w-16 h-16 border-4 border-neon-green/20 border-t-neon-green rounded-full animate-spin"></div>
            <div className="mt-4 font-mono text-neon-green text-sm tracking-widest animate-pulse">RESTORING UPLINK...</div>
        </div>
      );
  }

  if (!currentUser) {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center p-4 relative overflow-hidden bg-black text-white font-mono selection:bg-neon-green selection:text-black">
        {/* Style Injection for Hacker Effects */}
        <style>{`
          @keyframes glitch-anim-1 {
            0% { clip-path: inset(20% 0 80% 0); transform: translate(-2px, 1px); }
            20% { clip-path: inset(60% 0 10% 0); transform: translate(2px, -1px); }
            40% { clip-path: inset(40% 0 50% 0); transform: translate(-2px, 2px); }
            60% { clip-path: inset(80% 0 5% 0); transform: translate(2px, -2px); }
            80% { clip-path: inset(10% 0 70% 0); transform: translate(-1px, 1px); }
            100% { clip-path: inset(30% 0 50% 0); transform: translate(1px, -1px); }
          }
          .glitch-title { position: relative; }
          .glitch-title::before, .glitch-title::after {
            content: attr(data-text);
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
          }
          .glitch-title::before {
            left: 2px; text-shadow: -1px 0 #00ff41; background: black;
            animation: glitch-anim-1 2s infinite linear alternate-reverse;
          }
          .glitch-title::after {
            left: -2px; text-shadow: -1px 0 #bc13fe; background: black;
            animation: glitch-anim-1 3s infinite linear alternate-reverse;
          }
          .scanline {
            background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.2));
            background-size: 100% 4px;
            animation: scanline 10s linear infinite;
            pointer-events: none;
          }
        `}</style>

        {/* Dynamic Background */}
        <div className="absolute inset-0 pointer-events-none z-0">
           {/* Animated Grid */}
           <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,65,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,65,0.05)_1px,transparent_1px)] bg-[size:50px_50px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_100%)]"></div>
           {/* Floating Particles */}
           <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-neon-green/10 rounded-full blur-[80px] animate-pulse"></div>
           <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-neon-purple/10 rounded-full blur-[80px] animate-pulse" style={{animationDelay: '1s'}}></div>
           {/* Noise Overlay */}
           <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-overlay"></div>
           {/* Scanline Overlay */}
           <div className="absolute inset-0 scanline z-50"></div>
        </div>
        
        <div className="max-w-md w-full relative z-10">
           {/* Terminal Header */}
           <div className="mb-8 text-center relative">
              <div className="inline-block p-4 border border-neon-green/30 bg-black/50 backdrop-blur-sm rounded-lg mb-6 shadow-[0_0_30px_rgba(0,255,65,0.1)]">
                 <Terminal className="w-12 h-12 text-neon-green animate-pulse" />
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tighter mb-2 glitch-title text-white" data-text="ATPUKUR BOYS">
                ATPUKUR BOYS
              </h1>
              <div className="flex items-center justify-center gap-2 text-xs tracking-[0.4em] text-gray-500 uppercase">
                 <span className="w-2 h-2 bg-neon-green rounded-full animate-ping"></span>
                 Secure Uplink v2.0
              </div>
           </div>

           {/* Login Card */}
           <div className="bg-black/40 border border-white/10 backdrop-blur-xl p-8 rounded-xl shadow-2xl relative overflow-hidden group">
              {/* Card Decoration */}
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-neon-green to-transparent opacity-50"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-neon-green/50 rounded-br-lg"></div>
              <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-neon-green/50 rounded-tl-lg"></div>
              
              {loginError && (
                <div className="mb-6 p-3 bg-red-900/20 border border-red-500/50 rounded flex items-center gap-3 animate-in slide-in-from-top-2">
                   <AlertTriangle className="w-4 h-4 text-red-500" />
                   <span className="text-xs text-red-400 font-mono tracking-wide">{loginError}</span>
                </div>
              )}

              <div className="space-y-6">
                <button 
                  onClick={async () => {
                    if (!supabase) return;
                    setLoginError(null);
                    try {
                      const { error } = await supabase.auth.signInWithOAuth({
                        provider: 'google',
                        options: {
                          redirectTo: `${window.location.origin}/`
                        }
                      });
                      if (error) throw error;
                    } catch (err: any) {
                      console.error("Login Error:", err);
                      setLoginError(err.message || "UPLINK FAILED");
                    }
                  }}
                  className="w-full bg-white text-black py-4 rounded-lg font-mono font-bold tracking-widest uppercase hover:bg-gray-200 transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.2)] relative overflow-hidden group/btn flex items-center justify-center gap-3"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  <span className="relative z-10">
                    Authenticate via Google
                  </span>
                </button>
              </div>

              <div className="mt-6 text-center">
                 <p className="text-[10px] text-gray-600 font-mono">
                    ENCRYPTION: AES-256-GCM // SERVER: ON-LINE
                 </p>
                 <a href="https://t.me/Its_Gods" target="_blank" rel="noopener noreferrer" className="block mt-2 text-[10px] text-neon-green/40 hover:text-neon-green font-mono tracking-widest uppercase transition-colors">
                    SYSTEM ARCHITECT: @Its_Gods
                 </a>
              </div>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row bg-black relative overflow-hidden">
      <audio ref={remoteAudioRef} autoPlay />
      
      {/* App Background */}
      <div className="absolute inset-0 pointer-events-none z-0">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-neon-blue/5 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-neon-green/5 rounded-full blur-[120px]"></div>
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] mix-blend-overlay"></div>
      </div>

      {showAdmin && <AdminDashboard onClose={() => setShowAdmin(false)} />}
      {showProfile && currentUser && (
        <UserProfileDashboard 
          user={currentUser} 
          onClose={() => setShowProfile(false)} 
          onUpdate={(updated) => setCurrentUser(updated)} 
        />
      )}

      {/* CALL OVERLAY UI */}
      {callStatus !== 'idle' && (
        <div className={`fixed inset-0 z-50 flex flex-col items-center justify-between animate-in fade-in duration-300 ${hasRemoteVideo ? 'bg-black' : 'bg-[#0a0a0a]'}`}>
           
           {/* Background Layer */}
           {!hasRemoteVideo && (
             <>
               {/* Blurred Avatar Background */}
               <div className="absolute inset-0 overflow-hidden z-0 opacity-30">
                  <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/80 z-10"></div>
                  <div className="w-full h-full flex items-center justify-center blur-[100px] scale-150">
                     <UserAvatar 
                        user={incomingCallUser || activeUser || { username: "" }} 
                        className="w-full h-full bg-transparent border-none shadow-none" 
                        emojiClassName="text-[150px]"
                     />
                  </div>
               </div>
               {/* Noise/Cyber Overlay */}
               <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.05] mix-blend-overlay z-0"></div>
             </>
           )}

           {/* Remote Video Layer */}
           <video 
              key={hasRemoteVideo ? 'remote-video-active' : 'remote-video-inactive'}
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              muted={false}
              className={`absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-500 ${hasRemoteVideo ? 'opacity-100' : 'opacity-0'}`} 
           />

           {/* Top Header */}
           <div className="relative z-10 w-full pt-12 pb-4 flex flex-col items-center bg-gradient-to-b from-black/80 to-transparent">
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-4 shadow-lg">
                  <Lock className="w-3 h-3 text-neon-green" />
                  <span className="text-[10px] font-mono text-neon-green tracking-widest uppercase">End-to-End Encrypted</span>
              </div>
              <h2 className="text-3xl font-mono font-bold text-white tracking-tight drop-shadow-md">
                {incomingCallUser?.username || activeUser?.username}
              </h2>
              <p className="text-sm font-mono text-gray-300 tracking-widest mt-2">
                 {callStatus === 'connected' ? formatDuration(callDuration) : callStatus === 'incoming' ? 'INCOMING CALL...' : 'CALLING...'}
              </p>
           </div>

           {/* Center Content (Avatar) - Only visible if no video */}
           {!hasRemoteVideo && (
              <div className="relative z-10 flex-1 flex items-center justify-center w-full">
                 <div className="relative group">
                    {/* Ripples */}
                    <div className={`absolute inset-0 rounded-full animate-ping opacity-20 ${callStatus === 'incoming' ? 'bg-neon-purple' : 'bg-neon-green'}`}></div>
                    <div className={`absolute inset-0 rounded-full animate-pulse opacity-20 blur-xl ${callStatus === 'incoming' ? 'bg-neon-purple' : 'bg-neon-green'}`}></div>
                    
                    <UserAvatar 
                      user={incomingCallUser || activeUser || { username: "" }} 
                      className="w-40 h-40 rounded-full text-7xl z-10" 
                      emojiClassName="text-7xl"
                    />
                 </div>
              </div>
           )}

           {/* Bottom Controls Panel */}
           <div className={`relative z-10 w-full pb-10 pt-8 px-8 flex flex-col items-center justify-end bg-gradient-to-t from-black via-black/80 to-transparent ${hasRemoteVideo ? 'opacity-0 hover:opacity-100 transition-opacity duration-300' : ''}`}>
              
              {callStatus === 'incoming' ? (
                 /* Incoming Call UI */
                 <div className="flex w-full justify-between items-center max-w-xs mx-auto mb-4">
                     <div className="flex flex-col items-center gap-2">
                         <button 
                           onClick={cleanupCall} 
                           className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg hover:bg-red-600 transition-transform hover:scale-105"
                         >
                            <PhoneOff className="w-7 h-7" />
                         </button>
                         <span className="text-[10px] font-mono text-gray-400 tracking-widest">DECLINE</span>
                     </div>
                     <div className="flex flex-col items-center gap-2">
                         <button 
                           onClick={answerCall} 
                           className="w-16 h-16 rounded-full bg-neon-green text-black flex items-center justify-center shadow-lg hover:bg-[#00cc33] transition-transform hover:scale-105 animate-pulse"
                         >
                            <Phone className="w-7 h-7 fill-current" />
                         </button>
                         <span className="text-[10px] font-mono text-gray-400 tracking-widest">ACCEPT</span>
                     </div>
                 </div>
              ) : (
                 /* Active Call UI */
                 <div className="w-full max-w-sm mx-auto flex flex-col gap-6">
                     {/* Secondary Controls Row */}
                     <div className="flex justify-center items-center gap-8">
                        {/* Mute Button */}
                        <button 
                          onClick={toggleMute}
                          className={`flex flex-col items-center gap-2 group transition-all duration-300 ${isMuted ? 'text-black' : 'text-white'}`}
                        >
                           <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 border ${isMuted ? 'bg-white border-white' : 'bg-white/10 border-white/10 hover:bg-white/20'}`}>
                              {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                           </div>
                        </button>
                     </div>

                     {/* End Call Button */}
                     <div className="flex justify-center">
                        <button 
                           onClick={endCall} 
                           className="w-20 h-20 rounded-full bg-red-500 text-white flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.4)] transition-transform hover:scale-105 hover:bg-red-600"
                        >
                           <PhoneOff className="w-9 h-9 fill-current" />
                        </button>
                     </div>
                 </div>
              )}
           </div>
        </div>
      )}

      {/* Sidebar */}
      <div className={`
        ${showSidebarMobile ? 'flex' : 'hidden'} 
        md:flex flex-col w-full md:w-80 border-r border-white/10 bg-black/40 backdrop-blur-xl z-20 h-full
      `}>
        {/* User Profile Header */}
        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
          <button 
            onClick={() => setShowProfile(true)}
            className="flex items-center gap-3 hover:bg-white/5 p-2 -ml-2 rounded-lg transition-colors text-left group"
          >
            <div className="w-10 h-10 rounded-sm bg-gradient-to-br from-gray-900 to-black border border-white/20 flex items-center justify-center shadow-lg text-lg overflow-hidden relative">
               {currentUser.avatar_url ? (
                 <img src={currentUser.avatar_url} alt={currentUser.username} className="w-full h-full object-cover" />
               ) : (
                 getAvatarEmoji(currentUser.username)
               )}
               <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                 <UserIcon className="w-4 h-4 text-white" />
               </div>
            </div>
            <div>
              <div className="font-mono font-bold text-white text-sm group-hover:text-neon-green transition-colors">
                {currentUser.full_name || currentUser.username}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-1.5 h-1.5 bg-neon-green rounded-full shadow-[0_0_5px_#00ff41] animate-pulse"></span>
                <span className="text-[9px] text-neon-green uppercase tracking-wider">Online</span>
              </div>
            </div>
          </button>
          <button onClick={handleLogout} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors" title="Disconnect Uplink">
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
                 relative group p-3 rounded-sm cursor-pointer transition-all duration-300 border overflow-hidden
                 ${activeUser?.id === GROUP_CHAT_ID 
                    ? 'bg-neon-purple/10 border-neon-purple/40 border-l-2 border-l-neon-purple' 
                    : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}
               `}
             >
               <div className="flex items-center gap-3 relative z-10">
                  <div className={`p-2 rounded-sm transition-colors text-lg`}>
                     🌐
                  </div>
                  <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <div className={`font-mono text-sm font-bold truncate ${activeUser?.id === GROUP_CHAT_ID ? 'text-white' : 'text-gray-300'}`}>PUBLIC_NET</div>
                        {unreadCounts[GROUP_CHAT_ID] ? (
                          <div className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-sm shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-pulse border border-red-400">
                            {unreadCounts[GROUP_CHAT_ID]}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-gray-500 truncate mt-0.5">Broadcast Channel</div>
                  </div>
               </div>
             </div>
          </div>

          <div className="px-2 mb-2 flex items-center gap-2">
            <Lock className="w-3 h-3 text-gray-500" />
            <span className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">Private Uplinks</span>
          </div>
          
          {sortedUsers.map(user => (
            <div 
              key={user.id}
              onClick={() => { setActiveUser(user); setShowSidebarMobile(false); }}
              className={`
                relative group p-3 rounded-sm cursor-pointer transition-all duration-300 border mb-2
                ${activeUser?.id === user.id 
                   ? 'bg-white/10 border-white/20 border-l-2 border-l-white' 
                   : 'bg-transparent border-transparent hover:bg-white/5'}
              `}
            >
              <div className="flex items-center gap-3 relative z-10">
                <div className="relative">
                  <UserAvatar user={user} className="w-10 h-10" />
                  <div className={`absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-black ${getIsUserOnline(user.id) ? 'bg-neon-green shadow-[0_0_5px_rgba(0,255,65,0.8)]' : 'bg-gray-600'}`} />
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
                      user.role === 'admin' && <span className="text-[8px] border border-neon-purple/40 text-neon-purple px-1 rounded-sm">ADMIN</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                     <span className="text-[10px] text-gray-500 font-mono truncate">
                       {getIsUserOnline(user.id) ? 'ACTIVE NOW' : `SEEN: ${new Date(user.last_seen).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`}
                     </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-black/20 flex flex-col gap-2">
           {currentUser.role === 'admin' ? (
             <NeonButton 
               variant="primary" 
               className="w-full flex items-center justify-center gap-2 rounded-sm"
               onClick={() => setShowAdmin(true)}
             >
               <Shield className="w-4 h-4" />
               ADMIN_PANEL
             </NeonButton>
           ) : (
             <div className="w-full p-2 rounded-sm border border-white/5 bg-white/5 flex items-center justify-center gap-2">
               <Lock className="w-3 h-3 text-gray-500" />
               <span className="text-[10px] font-mono text-gray-500 tracking-widest uppercase">
                 ENCRYPTED v2.0
               </span>
             </div>
           )}
           <a href="https://t.me/Its_Gods" target="_blank" rel="noopener noreferrer" className="text-[9px] text-center text-gray-600 hover:text-neon-blue font-mono tracking-widest uppercase transition-colors mt-1 opacity-50 hover:opacity-100">
              DEV_NODE: @Its_Gods
           </a>
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
                    {activeUser.id === GROUP_CHAT_ID ? (
                       <div className="w-9 h-9 rounded-sm flex items-center justify-center shadow-lg text-lg bg-neon-purple/20 text-neon-purple">
                           {getAvatarEmoji(activeUser.username)}
                       </div>
                    ) : (
                       <UserAvatar user={activeUser} className="w-9 h-9" />
                    )}
                  <div>
                    <div className="font-mono font-bold text-white flex items-center gap-2 text-sm md:text-base">
                      {activeUser.username}
                      {activeUser.role === 'admin' && activeUser.id !== GROUP_CHAT_ID && <Badge status="admin" />}
                    </div>
                    <div className={`text-[10px] font-mono tracking-widest uppercase flex items-center gap-1.5 ${activeUser.id === GROUP_CHAT_ID ? 'text-neon-purple' : 'text-neon-blue'}`}>
                       {activeUser.id === GROUP_CHAT_ID 
                          ? 'BROADCAST FREQUENCY' 
                          : (getIsUserOnline(activeUser.id) 
                              ? <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse"></span> SECURE CONNECTION</span> 
                              : <span className="flex items-center gap-1.5"><Clock className="w-3 h-3"/> OFFLINE</span>
                            )
                       }
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Call Button (Private Chats Only) */}
              {activeUser.id !== GROUP_CHAT_ID && currentUser.can_send && (
                <button 
                  onClick={startCall}
                  className="p-2 text-neon-green bg-neon-green/10 border border-neon-green/30 rounded-sm hover:bg-neon-green hover:text-black transition-all hover:shadow-[0_0_10px_rgba(0,255,65,0.4)]"
                  title="Initiate Encrypted Voice Uplink"
                >
                  <Phone className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scroll-smooth bg-black/40">
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
                        
                        {/* Avatar for others */}
                        {!isMe && (
                          <UserAvatar 
                            user={users.find(u => u.id === msg.sender_id) || { username: msg.username }} 
                            className="w-8 h-8 text-sm" 
                          />
                        )}

                        <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                           {/* The Squared Data Bubble */}
                           <div className={`
                             relative px-4 py-3 text-sm leading-relaxed shadow-lg min-w-[140px]
                             ${isMe 
                               ? 'bg-neon-green/10 text-neon-green border-t border-b border-l border-neon-green/30 border-r-2 border-r-neon-green rounded-sm' 
                               : 'bg-white/5 text-gray-200 border-t border-b border-r border-white/10 border-l-2 border-l-white/40 rounded-sm'}
                           `}>
                             {/* Sender Name Inside Bubble */}
                             {isGroup && !isMe && showHeader && (
                               <div className="text-[10px] font-mono font-bold text-neon-purple mb-1.5 pb-1 border-b border-white/10 block w-full">
                                 {msg.username}
                               </div>
                             )}

                             {msg.message}
                             
                             {/* Metadata Footer */}
                             <div className={`flex items-center gap-2 mt-2 pt-2 border-t ${isMe ? 'border-neon-green/20' : 'border-white/5'}`}>
                                <span className={`text-[9px] font-mono uppercase tracking-wider opacity-60 ${isMe ? 'text-neon-green' : 'text-gray-500'}`}>
                                   TS: {new Date(msg.created_at).toLocaleTimeString([], {hour12: false, hour: '2-digit', minute:'2-digit'})}
                                </span>
                                {isMe && <Check className="w-3 h-3 opacity-60" />}
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
              <form onSubmit={sendMessage} className="flex gap-4 relative max-w-4xl mx-auto w-full items-end">
                 <div className="relative flex-1 group">
                    <div className={`absolute -inset-0.5 rounded-sm blur opacity-20 transition duration-500 group-hover:opacity-40 ${activeUser.id === GROUP_CHAT_ID ? 'bg-neon-purple' : 'bg-neon-green'}`}></div>
                    <Input 
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder={currentUser.can_send ? (activeUser.id === GROUP_CHAT_ID ? "Broadcast to public net..." : "Encrypted message...") : "ACCESS RESTRICTED"}
                        disabled={!currentUser.can_send}
                        className="bg-black relative pr-12 text-sm rounded-sm border-white/10 focus:border-neon-green/50"
                    />
                    {inputText && (
                       <div className="absolute right-3 top-1/2 -translate-y-1/2 w-2 h-4 bg-neon-green/50 animate-pulse"></div>
                    )}
                 </div>
                 <button 
                   type="submit" 
                   disabled={!inputText.trim() || !currentUser.can_send}
                   className={`
                      p-3 rounded-sm flex items-center justify-center transition-all duration-300 h-[46px] w-[46px]
                      ${!inputText.trim() ? 'bg-white/5 text-gray-600 border border-white/5' : (activeUser.id === GROUP_CHAT_ID ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/50 shadow-[0_0_15px_rgba(188,19,254,0.3)] hover:bg-neon-purple hover:text-white' : 'bg-neon-green/20 text-neon-green border border-neon-green/50 shadow-[0_0_15px_rgba(0,255,65,0.3)] hover:bg-neon-green hover:text-black')}
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