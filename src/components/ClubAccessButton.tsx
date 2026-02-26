import React from 'react';
import { DoorOpen } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

interface ClubAccessButtonProps {
  userId: string;
}

export const ClubAccessButton: React.FC<ClubAccessButtonProps> = ({ userId }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const isInClub = location.pathname.startsWith('/club');
  const targetRoute = isInClub ? '/trade' : '/club';
  const buttonLabel = isInClub ? 'Return to AI Trading' : 'Access Pipnosis Club';

  const handleClick = () => {
    navigate(targetRoute);
  };

  if (isInClub) {
    return (
      <button
        onClick={handleClick}
        className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-purple-600/50 hover:bg-purple-500/60 text-white rounded-full p-4 shadow-lg transition-all duration-300 hover:scale-110 backdrop-blur-sm"
        aria-label={buttonLabel}
        title={buttonLabel}
      >
        <DoorOpen size={24} />
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-purple-600/50 hover:bg-purple-500/60 text-white rounded-full px-5 py-3 shadow-lg transition-all duration-300 hover:scale-105 flex items-center gap-3 backdrop-blur-sm"
      aria-label={buttonLabel}
      title={buttonLabel}
    >
      <span className="text-sm font-semibold whitespace-nowrap">Enter the Club and Chat with Members</span>
      <DoorOpen size={22} />
    </button>
  );
};
