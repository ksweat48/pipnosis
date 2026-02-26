import React, { useState } from 'react';
import { DoorOpen, ChevronRight, ChevronLeft } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

interface ClubAccessButtonProps {
  userId: string;
}

export const ClubAccessButton: React.FC<ClubAccessButtonProps> = ({ userId }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(true);

  const isInClub = location.pathname.startsWith('/club');
  const targetRoute = isInClub ? '/trade' : '/club';
  const buttonLabel = isInClub ? 'Return to AI Trading' : 'Enter the Club and Chat with Members';

  const handleNavigate = () => {
    navigate(targetRoute);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(prev => !prev);
  };

  return (
    <div
      className="fixed right-4 z-50 flex items-center justify-end"
      style={{ bottom: 'calc(60px + 16px + env(safe-area-inset-bottom))' }}
    >
      <div
        className="flex items-center bg-purple-600 hover:bg-purple-700 text-white rounded-full shadow-lg transition-all duration-300 overflow-hidden cursor-pointer"
        style={{ maxWidth: 'calc(100vw - 2rem)' }}
        onClick={handleNavigate}
      >
        <button
          onClick={handleToggle}
          className="flex items-center justify-center p-3 transition-colors duration-200 shrink-0"
          aria-label={isOpen ? 'Collapse label' : 'Expand label'}
        >
          {isOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>

        <div
          className={`flex items-center overflow-hidden transition-all duration-300 ease-in-out ${
            isOpen ? 'max-w-xs opacity-100' : 'max-w-0 opacity-0'
          }`}
        >
          <span className="text-sm font-semibold whitespace-nowrap pr-1">
            {buttonLabel}
          </span>
        </div>

        <div className="flex items-center justify-center p-3 shrink-0">
          <DoorOpen size={22} />
        </div>
      </div>
    </div>
  );
};
