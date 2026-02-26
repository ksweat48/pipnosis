import React from 'react';
import { DoorOpen } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

interface ClubAccessButtonProps {
  userId: string;
}

export const ClubAccessButton: React.FC<ClubAccessButtonProps> = ({ userId }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // SSOT: Context-aware navigation
  // When in club (/club/*), return to AI Trading page
  // When in main app, go to club
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
        className="fixed bottom-20 right-6 md:right-8 lg:right-12 z-50 bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white rounded-full p-4 shadow-lg transition-all duration-300 hover:scale-110"
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
      className="fixed bottom-20 right-6 md:right-8 lg:right-12 z-50 bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white rounded-full px-5 py-3 shadow-lg transition-all duration-300 hover:scale-105 flex items-center gap-3"
      aria-label={buttonLabel}
      title={buttonLabel}
    >
      <span className="text-sm font-semibold whitespace-nowrap">Enter the Club and Chat with Members</span>
      <DoorOpen size={22} />
    </button>
  );
};
