import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hoverEffect?: boolean;
  onClick?: () => void;
}

export const GlassCard: React.FC<GlassCardProps> = ({ children, className = '', hoverEffect = false, onClick }) => {
  return (
    <div 
      onClick={onClick}
      className={`
        relative overflow-hidden
        bg-glass-base backdrop-blur-xl
        border border-glass-border
        rounded-xl shadow-lg
        transition-all duration-300
        ${hoverEffect ? 'hover:bg-white/10 hover:border-neon-green/30 hover:shadow-[0_0_15px_rgba(0,255,65,0.15)] cursor-pointer' : ''}
        ${className}
      `}
    >
      {/* Glossy overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-glass-highlight to-transparent pointer-events-none" />
      <div className="relative z-10 h-full w-full">
        {children}
      </div>
    </div>
  );
};

export const NeonButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost' }> = ({ 
  children, 
  variant = 'primary', 
  className = '', 
  ...props 
}) => {
  const baseStyles = "px-6 py-2 rounded-lg font-mono text-sm font-bold uppercase tracking-wider transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-neon-green/10 text-neon-green border border-neon-green/50 hover:bg-neon-green hover:text-black hover:shadow-[0_0_20px_rgba(0,255,65,0.4)]",
    danger: "bg-red-500/10 text-red-400 border border-red-500/50 hover:bg-red-500 hover:text-white hover:shadow-[0_0_20px_rgba(239,68,68,0.4)]",
    ghost: "bg-transparent text-gray-400 hover:text-white hover:bg-white/5",
  };

  return (
    <button className={`${baseStyles} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => {
  return (
    <input 
      {...props}
      className={`
        w-full bg-black/40 border border-glass-border rounded-lg px-4 py-3
        text-white placeholder-gray-500 font-mono text-sm
        focus:outline-none focus:border-neon-green/70 focus:ring-1 focus:ring-neon-green/50
        transition-all duration-300
        ${props.className || ''}
      `}
    />
  );
};

export const Badge: React.FC<{ status: 'online' | 'offline' | 'admin' }> = ({ status }) => {
  if (status === 'admin') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-neon-purple/20 text-neon-purple border border-neon-purple/40 uppercase tracking-widest">
        Admin
      </span>
    );
  }
  return (
    <div className={`flex items-center gap-1.5 ${status === 'online' ? 'text-neon-green' : 'text-gray-500'}`}>
      <span className={`w-2 h-2 rounded-full ${status === 'online' ? 'bg-neon-green shadow-[0_0_8px_rgba(0,255,65,0.6)] animate-pulse' : 'bg-gray-600'}`} />
      <span className="text-xs font-mono uppercase tracking-wider">{status}</span>
    </div>
  );
};

export const getAvatarEmoji = (username: string) => {
  if (!username) return '👤';
  if (username === 'PUBLIC_NET') return '🌐';
  if (username.toLowerCase() === 'habib') return '👑';
  const emojis = ['👾', '🤖', '👽', '💀', '👻', '👺', '🤡', '☠️', '💻', '💾', '💿', '📼', '🕹️', '🔮', '🧬', '🦠', '🔋', '📡', '🔭', '🧱'];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return emojis[Math.abs(hash) % emojis.length];
};

export const UserAvatar: React.FC<{ user: { username: string; avatar_url?: string }; className?: string; emojiClassName?: string }> = ({ user, className = "w-10 h-10", emojiClassName = "text-lg" }) => {
  return (
    <div className={`rounded-sm bg-gradient-to-br from-gray-900 to-black border border-white/20 flex items-center justify-center shadow-lg overflow-hidden relative shrink-0 ${className}`}>
      {user.avatar_url ? (
        <img src={user.avatar_url} alt={user.username} className="w-full h-full object-cover" />
      ) : (
        <span className={emojiClassName}>{getAvatarEmoji(user.username)}</span>
      )}
    </div>
  );
};