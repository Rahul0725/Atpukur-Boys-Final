import React, { useEffect, useState, useRef } from 'react';
import { supabase, checkSupabaseConfig } from './supabaseClient';
import { User, Message } from './types';
import { GlassCard, NeonButton, Input, Badge } from './components/Layout';
import { AdminDashboard } from './components/AdminDashboard';
import { Send, LogOut, ChevronLeft, Shield, Clock, AlertTriangle, Lock, Globe, Users, Check, Bell, Phone, PhoneOff, Mic, MicOff, PhoneIncoming, Monitor, MonitorOff, Terminal, Cpu } from 'lucide-react';

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
  const [showSidebarMobile, setShowSidebarMobile] = useState(true);
  
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
    
    // Attempt to restore session from localStorage
    const restoreSession = async () => {
      const savedId = localStorage.getItem('atpukur_user_id');
      if (savedId && supabase) {
        try {
          const { data, error } = await supabase.from('users').select('*').eq('id', savedId).single();
          if (data && !error) {
            setCurrentUser(data as User);
            // Optionally update online status immediately
            await supabase.from('users').update({ is_online: true }).eq('id', savedId);
          }
        } catch (e) {
          console.error("Session restore failed", e);
          localStorage.removeItem('atpukur_user_id');
        }
      }
      setIsRestoringSession(false);
    };
    
    restoreSession();
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
  }, [hasRemoteVideo, remoteStreamRef.current]); // Added remoteStreamRef.current dependency

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
        if (!payload || payload.targetId !== currentUser.id) return;
        
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
      
      // If we receive a track, use the stream provided by the event or create one
      // Important: Use existing ref if the stream ID matches to avoid thrashing
      let stream = event.streams[0];
      if (!stream) {
          stream = new MediaStream();
          stream.addTrack(event.track);
      }
      
      remoteStreamRef.current = stream;

      if (event.track.kind === 'video') {
         console.log("Video track detected via ontrack");
         setHasRemoteVideo(true);
         
         // Force re-attach for video element
         if (remoteVideoRef.current) {
             remoteVideoRef.current.srcObject = stream;
             remoteVideoRef.current.play().catch(console.error);
         }

         event.track.onended = () => {
             console.log("Video track ended");
             setHasRemoteVideo(false);
         };
      } else if (event.track.kind === 'audio') {
          // If we have video, the video element plays the audio too if it's the same stream
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = stream;
            remoteAudioRef.current.play().catch(e => console.error("Error playing audio:", e));
          }
      }
    };

    // Add local tracks if they exist
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

      // Add local tracks to the existing PC (created when offer arrived)
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
    
    // Find and remove the video sender
    const senders = pc.getSenders();
    const videoSender = senders.find(s => s.track?.kind === 'video');
    
    if (videoSender) {
        pc.removeTrack(videoSender);
    }

    // Stop the local track
    if (localStreamRef.current) {
        const videoTracks = localStreamRef.current.getVideoTracks();
        videoTracks.forEach(t => {
            t.stop();
            localStreamRef.current?.removeTrack(t);
        });
    }

    setIsScreenSharing(false);

    // Negotiate removal
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

  const startScreenShare = async () => {
     if (!peerConnectionRef.current) return;
     const pc = peerConnectionRef.current;

     try {
        console.log("Requesting display media...");
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        
        screenTrack.onended = () => {
             stopScreenShare();
        };

        // Add to local stream for consistency, though not strictly required for sending
        if (localStreamRef.current) {
            localStreamRef.current.addTrack(screenTrack);
            // Add track to PC. Use localStreamRef to ensure stream ID matches if possible
            pc.addTrack(screenTrack, localStreamRef.current);
        } else {
            // Fallback if no audio call existed (unlikely in this flow)
            pc.addTrack(screenTrack, screenStream);
        }

        setIsScreenSharing(true);
        console.log("Screen track added, creating offer...");

        // Create Offer for renegotiation
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
            console.log("Screen share offer sent.");
        }
     } catch (e) {
        console.error("Failed to share screen", e);
        setIsScreenSharing(false);
     }
  };

  const toggleScreenShare = () => {
     if (isScreenSharing) {
        stopScreenShare();
     } else {
        startScreenShare();
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
    localStorage.removeItem('atpukur_user_id');
    setCurrentUser(null);
    setActiveUser(null);
    setMessages([]);
    setUnreadCounts({});
    setLoginError(null);
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

  const getInitials = (name: string) => name.substring(0, 2).toUpperCase();

  // Helper Component for Call Buttons
  const CallControlButton = ({ active, onClick, icon: Icon, label, variant = 'normal' }: any) => (
    <button 
      onClick={onClick}
      className="flex flex-col items-center gap-2 group"
    >
      <div className={`
        w-14 h-14 rounded-full border flex items-center justify-center transition-all duration-300
        ${variant === 'danger' 
          ? 'bg-red-500/20 border-red-500 text-red-500 hover:bg-red-500 hover:text-white shadow-[0_0_15px_rgba(239,68,68,0.3)]' 
          : variant === 'accept'
             ? 'bg-neon-green/10 border-neon-green text-neon-green hover:bg-neon-green hover:text-black shadow-[0_0_15px_rgba(0,255,65,0.3)] animate-pulse'
          : active 
            ? 'bg-white text-black border-white shadow-[0_0_15px_rgba(255,255,255,0.3)]' 
            : 'bg-black/40 text-gray-300 border-white/20 hover:border-white hover:text-white hover:bg-white/10'
        }
      `}>
        <Icon className="w-6 h-6" />
      </div>
      <span className="text-[10px] font-mono uppercase tracking-widest opacity-70 group-hover:opacity-100 transition-opacity text-gray-400">
        {label}
      </span>
    </button>
  );

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

              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-gray-500 ml-1">Identify Yourself</label>
                  <div className="relative group/input">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neon-green font-mono text-sm pointer-events-none">{">_"}</span>
                    <input 
                      autoFocus
                      type="text"
                      placeholder="ENTER_ALIAS" 
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      className="w-full bg-black/50 border border-white/20 rounded-lg py-4 pl-10 pr-4 text-white font-mono text-sm focus:outline-none focus:border-neon-green focus:shadow-[0_0_20px_rgba(0,255,65,0.2)] transition-all placeholder-gray-700"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                       <Cpu className="w-4 h-4 text-gray-600 group-focus-within/input:text-neon-green transition-colors" />
                    </div>
                  </div>
                </div>

                <button 
                  type="submit" 
                  className="w-full bg-neon-green/10 border border-neon-green/50 text-neon-green py-4 rounded-lg font-mono font-bold tracking-widest uppercase hover:bg-neon-green hover:text-black transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,255,65,0.4)] relative overflow-hidden group/btn"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    Initialize Connection <ChevronLeft className="w-4 h-4 rotate-180" />
                  </span>
                  <div className="absolute inset-0 bg-neon-green/20 -translate-x-full group-hover/btn:translate-x-0 transition-transform duration-300"></div>
                </button>
              </form>

              <div className="mt-6 text-center">
                 <p className="text-[10px] text-gray-600 font-mono">
                    ENCRYPTION: AES-256-GCM // SERVER: ON-LINE
                 </p>
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

      {/* CALL OVERLAY UI */}
      {callStatus !== 'idle' && (
        <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center p-4 animate-in fade-in duration-300 ${hasRemoteVideo ? 'bg-black' : 'bg-black/95 backdrop-blur-2xl'}`}>
           
           {/* Background Effects */}
           {!hasRemoteVideo && (
             <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {/* Grid */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,65,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,65,0.03)_1px,transparent_1px)] bg-[size:40px_40px]"></div>
                {/* Ambient Glow */}
                <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-[100px] opacity-20 animate-pulse ${callStatus === 'connected' ? 'bg-neon-green' : callStatus === 'incoming' ? 'bg-neon-purple' : 'bg-neon-blue'}`}></div>
             </div>
           )}

           {/* Remote Video Element */}
           <video 
              key={hasRemoteVideo ? 'remote-video-active' : 'remote-video-inactive'}
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              muted={false}
              className={`absolute inset-0 w-full h-full object-contain z-0 transition-opacity duration-500 ${hasRemoteVideo ? 'opacity-100' : 'opacity-0'}`} 
           />

           {/* Main Container */}
           <div className={`relative z-10 flex flex-col items-center w-full transition-all duration-500 ${hasRemoteVideo ? 'mt-auto mb-8 max-w-3xl bg-black/80 p-6 rounded-2xl backdrop-blur-xl border border-white/10 shadow-2xl' : 'max-w-sm'}`}>
              
              {/* Header / Status info when video is active */}
              {hasRemoteVideo && (
                 <div className="absolute top-0 left-0 right-0 -mt-16 flex justify-between px-6 pointer-events-none">
                    <div className="bg-black/60 backdrop-blur border border-white/10 rounded-full px-4 py-2 flex items-center gap-2 shadow-lg">
                       <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                       <span className="font-mono text-xs text-white tracking-wider">{formatDuration(callDuration)}</span>
                    </div>
                    <div className="bg-black/60 backdrop-blur border border-white/10 rounded-full px-4 py-2 shadow-lg">
                       <span className="font-mono text-xs text-white tracking-wider">{incomingCallUser?.username || activeUser?.username}</span>
                    </div>
                 </div>
              )}

              {/* Avatar & Info (Hidden if Video Active) */}
              {!hasRemoteVideo && (
                <div className="flex flex-col items-center mb-12 w-full">
                   {/* Incoming Call Header */}
                   {callStatus === 'incoming' && (
                     <div className="w-full bg-neon-purple/10 border-y border-neon-purple/30 py-2 mb-8 text-center animate-pulse">
                       <p className="font-mono text-neon-purple tracking-[0.3em] text-xs font-bold uppercase">Incoming Encrypted Signal</p>
                     </div>
                   )}

                   {/* Avatar Hexagon/Circle */}
                   <div className="mb-8 relative group">
                      <div className="w-40 h-40 rounded-full bg-black border border-white/10 flex items-center justify-center relative overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] z-10">
                         <span className="font-mono text-5xl text-white font-bold">
                            {getInitials((incomingCallUser?.username || activeUser?.username || "?"))}
                         </span>
                      </div>
                      
                      {/* Orbital Rings */}
                      <div className={`absolute inset-0 -m-4 border border-dashed rounded-full animate-[spin_10s_linear_infinite] opacity-30 ${callStatus === 'incoming' ? 'border-neon-purple' : 'border-neon-green'}`}></div>
                      <div className={`absolute inset-0 -m-8 border border-dotted rounded-full animate-[spin_15s_linear_infinite_reverse] opacity-20 ${callStatus === 'incoming' ? 'border-neon-purple' : 'border-neon-blue'}`}></div>
                      
                      {/* Status Pulse */}
                      <div className={`absolute -bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-black border rounded text-[10px] font-mono tracking-widest uppercase z-20 whitespace-nowrap ${
                        callStatus === 'connected' ? 'border-neon-green text-neon-green shadow-[0_0_10px_rgba(0,255,65,0.2)]' :
                        callStatus === 'incoming' ? 'border-neon-purple text-neon-purple shadow-[0_0_10px_rgba(188,19,254,0.2)] animate-pulse' :
                        'border-neon-blue text-neon-blue'
                      }`}>
                        {callStatus === 'connected' ? formatDuration(callDuration) : callStatus === 'incoming' ? 'CONNECTING...' : 'DIALING...'}
                      </div>
                   </div>

                   <h2 className="text-3xl font-mono text-white font-bold mb-2 tracking-tight text-center">
                     {incomingCallUser?.username || activeUser?.username}
                   </h2>
                   <p className="text-xs font-mono text-gray-500 tracking-[0.2em] uppercase">
                     {callStatus === 'connected' ? 'Secure Voice Channel' : 'Establishing Handshake'}
                   </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-end justify-center gap-6 md:gap-8">
                 
                 {/* Incoming Call Actions */}
                 {callStatus === 'incoming' ? (
                   <>
                      <CallControlButton 
                        icon={PhoneOff} 
                        variant="danger" 
                        onClick={cleanupCall} 
                        label="DECLINE"
                      />
                      <div className="w-px h-12 bg-white/10 mx-2"></div>
                      <CallControlButton 
                        icon={Phone} 
                        variant="accept"
                        onClick={answerCall} 
                        label="ACCEPT"
                      />
                   </>
                 ) : (
                   /* Active Call Actions */
                   <>
                     <CallControlButton 
                       icon={isMuted ? MicOff : Mic} 
                       active={!isMuted} // If not muted, it's "active" (white). If muted, dark.
                       onClick={toggleMute} 
                       label={isMuted ? "UNMUTE" : "MUTE"}
                     />
                     
                     <CallControlButton 
                       icon={isScreenSharing ? MonitorOff : Monitor} 
                       active={isScreenSharing} 
                       onClick={toggleScreenShare} 
                       label={isScreenSharing ? "STOP" : "SHARE"}
                     />

                     <div className="w-px h-12 bg-white/10 mx-2"></div>

                     <CallControlButton 
                       icon={PhoneOff} 
                       variant="danger" 
                       onClick={endCall} 
                       label="END"
                     />
                   </>
                 )}
              </div>

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
              
              {/* Call Button (Private Chats Only) */}
              {activeUser.id !== GROUP_CHAT_ID && currentUser.can_send && (
                <button 
                  onClick={startCall}
                  className="p-2 text-neon-green bg-neon-green/10 border border-neon-green/30 rounded-lg hover:bg-neon-green hover:text-black transition-all hover:shadow-[0_0_10px_rgba(0,255,65,0.4)]"
                  title="Initiate Encrypted Voice Uplink"
                >
                  <Phone className="w-5 h-5" />
                </button>
              )}
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